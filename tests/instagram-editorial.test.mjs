import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { createInstagramEditorial, editorialClock, editorialDue, editorialImageUrl } from '../lib/instagram-editorial.js';
import { editorialPlan } from '../lib/editorial-content.js';
import { createInstagramEditorialHandler } from '../lib/instagram-editorial-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';
import { createAdminSession, hashAdminToken, ADMIN_COOKIE_NAME } from '../lib/admin-security.js';
import { feedEditorialPlan } from '../lib/editorial-simulator.js';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
import { scheduledEditorialPlan } from '../lib/electric-editorial-calendar.js';

const STATE = 'instagram/editorial/v1/production/state.json';
const post = (date, format = 'IMAGE') => ({ id: `editorial-${date}-rotina`, date, title: 'Cabe na tua rotina?',
  topic: 'Escolha do carro', topicId: `rotina-${date}`, format,
  caption: 'Experimenta a bagageira com aquilo que transportas todos os dias. Guarda esta dica.',
  slides: Array.from({ length: format === 'IMAGE' ? 1 : 4 }, (_, index) => ({ title: `Dica ${index + 1}`, altText: `Conselho útil ${index + 1}` })) });

function fixture(options = {}) {
  const memory = memoryBlob(); const calls = [];
  const env = { VERCEL_ENV: 'production', INSTAGRAM_EDITORIAL_ENABLED: 'true', ADMIN_SESSION_SECRET: 'fixture-only-secret-for-test-purpose',
    INSTAGRAM_ACCESS_TOKEN: 'synthetic-bootstrap-credential-only', INSTAGRAM_USER_ID: '17841400000000000',
    INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app', ...options.env };
  let clock = Date.parse(options.time || '2026-11-21T19:30:00Z');
  let accountName = 'autovalorpt'; let containerStatus = 'FINISHED'; let sequence = [];
  let failPublish = false; let failCreate = false; let counter = 900000;
  let limits = { data: [{ quota_usage: 3, config: { quota_total: 100, quota_duration: 86400 } }] }; let denyLimits = false;
  let planFor = options.planFor || (date => post(date, options.format));
  let beforeResponse = null; let tokenResolutions = 0;
  const fetchImpl = async (url, settings) => {
    calls.push({ url, method: settings.method || 'GET', body: settings.body });
    const parsed = new URL(url);
    assert.equal(settings.headers.Authorization, 'Bearer synthetic-renewed-token-only');
    assert.equal(parsed.searchParams.has('access_token'), false);
    if (beforeResponse) await beforeResponse(url, settings);
    if (parsed.pathname.endsWith('/me')) return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: accountName });
    if (parsed.pathname.endsWith(`/${env.INSTAGRAM_USER_ID}`)) return Response.json({ id: env.INSTAGRAM_USER_ID, username: accountName });
    if (parsed.pathname.endsWith('/content_publishing_limit')) return denyLimits ?
      Response.json({ error: { code: 10, message: 'private-permission-details' } }, { status: 403 }) : Response.json(limits);
    if (parsed.pathname.endsWith('/media') && settings.method === 'POST') {
      assert.equal(JSON.parse(memory.records.get(STATE).text).active.phase, 'creating');
      if (failCreate) return Response.json({ error: { code: 100, message: 'private-provider-detail-and-token' } }, { status: 400 });
      return Response.json({ id: String(++counter) });
    }
    if (parsed.pathname.endsWith('/media_publish')) {
      assert.equal(JSON.parse(memory.records.get(STATE).text).active.phase, 'publishing');
      if (failPublish) throw new Error('synthetic-private-token-in-error');
      return Response.json({ id: '80000001' });
    }
    if (parsed.pathname.endsWith('/media')) return Response.json({ data: [
      { id: '80000001', caption: post('2026-11-21').caption, timestamp: new Date(clock).toISOString(),
        permalink: 'https://www.instagram.com/p/EditorialTest01/' },
    ] });
    if (parsed.pathname.endsWith('/80000001')) return Response.json({ permalink: options.permalink || 'https://www.instagram.com/p/EditorialTest01/',
      is_ai_generated: options.aiLabel ?? true });
    return Response.json({ status_code: sequence.shift() || containerStatus });
  };
  const publisher = createInstagramEditorial({ env, storage: memory.storage, fetchImpl, now: () => clock,
    pause: async () => {}, pollAttempts: options.pollAttempts ?? 0, planFor: date => planFor(date),
    extraPlanFor: options.extraPlanFor, prepareElectricEdition: options.prepareElectricEdition,
    tokenManager: { resolve: async () => { tokenResolutions++; return 'synthetic-renewed-token-only'; },
      status: async () => ({ initialized: true, automaticRefresh: true, expired: false }) } });
  return { publisher, memory, calls, env,
    posts: () => calls.filter(call => call.url.endsWith('/media_publish')),
    tokenResolutions: () => tokenResolutions,
    advance: ms => { clock += ms; }, setTime: value => { clock = Date.parse(value); },
    setAccount: value => { accountName = value; }, setContainerStatus: value => { containerStatus = value; },
    setSequence: value => { sequence = value; }, setFailPublish: value => { failPublish = value; },
    setFailCreate: value => { failCreate = value; }, setPlan: value => { planFor = value; },
    setLimits: value => { limits = value; }, denyLimits: value => { denyLimits = value; },
    setBeforeResponse: value => { beforeResponse = value; } };
}

test('local schedule follows Lisbon DST, seasonal cron guard and start date', () => {
  assert.equal(editorialDue('2026-11-20T20:00:00Z').reason, 'not_started');
  assert.equal(editorialDue('2026-11-21T18:59:59Z', { season: 'winter' }).due, false);
  assert.equal(editorialDue('2026-11-21T19:00:00Z', { season: 'winter' }).due, true);
  assert.equal(editorialDue('2026-11-21T19:59:59Z', { season: 'winter' }).due, true);
  assert.equal(editorialDue('2026-11-21T19:00:00Z', { season: 'summer' }).reason, 'inactive_season');
  assert.equal(editorialDue('2027-07-21T17:59:59Z', { season: 'summer' }).due, false);
  assert.equal(editorialDue('2027-07-21T18:00:00Z', { season: 'summer' }).due, true);
  assert.equal(editorialDue('2027-07-21T19:00:00Z', { season: 'winter' }).reason, 'inactive_season');
  assert.equal(editorialClock('2027-03-28T18:00:00Z').hour, 19);
  assert.equal(editorialClock('2027-10-31T19:00:00Z').hour, 19);
  assert.equal(editorialClock('2027-07-21T23:30:00Z').day, '2027-07-22');
  assert.equal(editorialDue('2027-07-21T18:00:00Z', { season: 'override' }).reason, 'invalid_season');
});

test('disabled, too early, preview and missing configuration cannot create media', async () => {
  const disabled = fixture({ env: { INSTAGRAM_EDITORIAL_ENABLED: 'false' } });
  assert.equal((await disabled.publisher.run()).status, 'disabled'); assert.equal(disabled.calls.length, 0);
  const early = fixture({ time: '2026-11-21T18:50:00Z' });
  assert.equal((await early.publisher.run({ date: '2026-11-22' })).status, 'before_schedule');
  assert.equal(early.calls.length, 0);
  const preview = fixture({ env: { VERCEL_ENV: 'preview' } });
  await assert.rejects(preview.publisher.run(), { code: 'production_required' }); assert.equal(preview.calls.length, 0);
  const missing = fixture({ env: { INSTAGRAM_ACCESS_TOKEN: '' } });
  await assert.rejects(missing.publisher.run(), { code: 'editorial_not_configured' }); assert.equal(missing.calls.length, 0);
});

test('validation resolves authorization and verifies exactly the allowed account without posting', async () => {
  const f = fixture(); const checked = await f.publisher.validate();
  assert.equal(checked.verified, true); assert.equal(checked.username, 'autovalorpt');
  assert.deepEqual(checked.publishingQuota, { usage: 3, total: 100, remaining: 97, durationSeconds: 86400 });
  assert.equal(checked.canPublishNow, true);
  assert.equal(f.tokenResolutions(), 1); assert.equal(f.posts().length, 0); assert.equal(f.memory.records.size, 0);
  f.setAccount('someone_else');
  await assert.rejects(f.publisher.validate(), { code: 'wrong_instagram_account' });
  await assert.rejects(f.publisher.setEnabled(true), { code: 'wrong_instagram_account' });
  assert.equal(f.memory.records.size, 0);
});

test('preview is read-only and exposes authored media URLs and the real schedule', async () => {
  const f = fixture({ time: '2026-11-20T21:00:00Z', format: 'CAROUSEL' });
  const status = await f.publisher.status(); const preview = await f.publisher.preview();
  assert.equal(status.schedule.nextRunAt, '2026-11-21T19:00:00.000Z');
  assert.equal(status.nextPost.slideCount, 4); assert.equal(preview.post.date, '2026-11-21');
  assert.equal(status.nextPost.images[3], 'https://autovalorpt-assistente.vercel.app/api/stock?integration=editorial-image&date=2026-11-21&slide=4&v=v1');
  assert.equal(f.calls.length, 0); assert.equal(f.memory.records.size, 0);
  await assert.rejects(f.publisher.preview('2026-02-30'), { code: 'editorial_date_invalid' });
  assert.throws(() => editorialImageUrl('2026-11-21', 1, { INSTAGRAM_PUBLIC_BASE_URL: 'https://localhost/' }), { code: 'editorial_image_invalid' });
});

test('one image per local day persists a permalink and concurrent runs cannot duplicate it', async () => {
  const f = fixture();
  const results = await Promise.all([f.publisher.run(), f.publisher.run()]);
  assert.equal(results.filter(result => result.status === 'published').length, 1);
  assert.equal(f.posts().length, 1);
  assert.equal((await f.publisher.run()).status, 'already_published');
  assert.equal(f.posts().length, 1);
  const status = await f.publisher.status();
  assert.equal(status.history[0].permalink, 'https://www.instagram.com/p/EditorialTest01/');
  assert.equal(status.nextPost.date, '2026-11-22');
  assert.equal(status.schedule.nextRunAt, '2026-11-22T19:00:00.000Z');
  assert.equal([...f.memory.records.keys()].includes('instagram/v1/production/state.json'), false);
});

test('carousel children and parent are created in order, then only the parent is published', async () => {
  const f = fixture({ format: 'CAROUSEL' });
  assert.equal((await f.publisher.run()).status, 'published');
  const creates = f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media'));
  assert.equal(creates.length, 5);
  for (let index = 0; index < 4; index++) {
    const form = new URLSearchParams(creates[index].body);
    assert.equal(form.get('is_carousel_item'), 'true'); assert.equal(form.has('caption'), false);
    assert.equal(new URL(form.get('image_url')).searchParams.get('slide'), String(index + 1));
    assert.match(form.get('alt_text'), /Conselho útil/);
  }
  const parent = new URLSearchParams(creates[4].body);
  assert.equal(parent.get('media_type'), 'CAROUSEL'); assert.equal(parent.get('children'), '900001,900002,900003,900004');
  assert.equal(new URLSearchParams(f.posts()[0].body).get('creation_id'), '900005');
});

test('a genuine conditional-write conflict cannot acquire the right to create or publish', async () => {
  const f = fixture(); f.memory.faults.put = () => { throw new BlobPreconditionFailedError(); };
  assert.equal((await f.publisher.run()).status, 'busy');
  assert.equal(f.calls.some(call => call.method === 'POST'), false);
});

test('uncertain publication is blocked, then reconciled by reads without a second publish', async () => {
  const f = fixture(); f.setFailPublish(true);
  const outcome = await f.publisher.run();
  assert.equal(outcome.status, 'review_required'); assert.equal(f.posts().length, 1);
  f.setFailPublish(false); f.advance(301_000);
  assert.equal((await f.publisher.run()).status, 'review_required'); assert.equal(f.posts().length, 1);
  f.setContainerStatus('PUBLISHED');
  const reconciled = await f.publisher.run();
  assert.equal(reconciled.status, 'published'); assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.permalink, 'https://www.instagram.com/p/EditorialTest01/'); assert.equal(f.posts().length, 1);
  const all = JSON.stringify(await f.publisher.status()) + [...f.memory.records.values()].map(record => record.text).join('');
  assert.doesNotMatch(all, /synthetic-private-token|synthetic-bootstrap|synthetic-renewed-token/);
});

test('a lost final storage acknowledgement leaves publication locked, never a fresh attempt', async () => {
  const f = fixture();
  f.memory.faults.put = (_path, value) => value.items?.['2026-11-21']?.status === 'published';
  await assert.rejects(f.publisher.run());
  f.memory.faults.put = null; f.advance(301_000);
  assert.equal((await f.publisher.run()).status, 'review_required'); assert.equal(f.posts().length, 1);
  assert.equal((await f.publisher.status()).active.phase, 'publishing');
});

test('preparing containers use a conditional transition before concurrent resumed publications', async () => {
  const f = fixture(); f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run()).status, 'preparing');
  f.setContainerStatus('FINISHED');
  const results = await Promise.all([f.publisher.run(), f.publisher.run()]);
  assert.equal(results.filter(result => result.status === 'published').length, 1); assert.equal(f.posts().length, 1);
});

test('a pause arriving while media prepares prevents its public publication', async () => {
  const f = fixture();
  let paused = false;
  f.setBeforeResponse(async url => {
    if (/\/900001\?/.test(url) && !paused) { paused = true; await f.publisher.setEnabled(false); }
  });
  assert.equal((await f.publisher.run()).status, 'disabled'); assert.equal(f.posts().length, 0);
  assert.equal((await f.publisher.status()).enabled, false);
});

test('explicit pause persists across later environment defaults and can resume a same-day container', async () => {
  const f = fixture(); await f.publisher.setEnabled(false);
  assert.equal((await f.publisher.run()).status, 'disabled'); assert.equal(f.calls.length, 0);
  await f.publisher.setEnabled(true);
  assert.equal((await f.publisher.run()).status, 'published'); assert.equal(f.posts().length, 1);
});

test('creation errors are bounded, sanitize provider details and never affect stock state', async () => {
  const f = fixture(); f.setFailCreate(true);
  for (let i = 0; i < 3; i++) assert.equal((await f.publisher.run()).status, 'failed');
  assert.equal((await f.publisher.run()).reason, 'attempt_limit'); assert.equal(f.posts().length, 0);
  const status = await f.publisher.status();
  assert.equal(status.lastResult.metaCode, 100); assert.equal(status.lastResult.metaStatus, 400);
  assert.doesNotMatch(JSON.stringify(status), /private-provider/);
  assert.equal([...f.memory.records.keys()].every(path => path.startsWith('instagram/editorial/')), true);
});

test('expired prior-day preparation is skipped and today can still publish once', async () => {
  const f = fixture(); f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run()).status, 'preparing');
  f.setTime('2026-11-22T19:20:00Z'); f.setContainerStatus('FINISHED');
  const outcome = await f.publisher.run();
  assert.equal(outcome.status, 'published'); assert.equal(outcome.date, '2026-11-22'); assert.equal(f.posts().length, 1);
  assert.equal((await f.publisher.status()).history[1].reason, 'past_publication_day');
});

test('a changed content fingerprint cannot publish an old prepared container', async () => {
  const f = fixture(); f.setContainerStatus('IN_PROGRESS'); await f.publisher.run();
  f.setPlan(date => ({ ...post(date), caption: 'Conteúdo revisto e diferente.' })); f.setContainerStatus('FINISHED');
  assert.equal((await f.publisher.run()).reason, 'content_changed'); assert.equal(f.posts().length, 0);
});

test('repeat topics inside 30 days are withheld without creating media', async () => {
  const f = fixture({ planFor: date => ({ ...post(date), topicId: 'bagageira' }) });
  await f.publisher.run(); f.setTime('2026-11-22T19:30:00Z');
  assert.equal((await f.publisher.run()).status, 'topic_recently_published'); assert.equal(f.posts().length, 1);
});

test('state binding and invalid content or permalink cannot turn into another account or external link', async () => {
  const f = fixture({ permalink: 'https://example.com/credential-collector' }); await f.publisher.run();
  assert.equal((await f.publisher.status()).history[0].permalink, undefined);
  f.env.INSTAGRAM_USER_ID = '17841499999999999';
  await assert.rejects(f.publisher.status(), { code: 'editorial_account_changed' });
  const bad = fixture({ planFor: date => ({ ...post(date), caption: 'x'.repeat(2201) }) });
  await assert.rejects(bad.publisher.run(), { code: 'editorial_content_invalid' }); assert.equal(bad.posts().length, 0);
});

test('Facebook mode and renewed authorization use the correct Graph host', async () => {
  const f = fixture({ env: { INSTAGRAM_LOGIN_MODE: 'facebook' } });
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(f.calls.every(call => call.url.startsWith('https://graph.facebook.com/')), true);
  assert.equal(f.tokenResolutions(), 1);
});

test('approved Reels use the fixed asset, current native AI label and completed processing before publishing', async () => {
  const f = fixture({ time: '2026-11-22T19:30:00Z', planFor: editorialPlan, pollAttempts: 1 });
  const preview = await f.publisher.preview();
  assert.equal(preview.post.videoUrl, 'https://autovalorpt-assistente.vercel.app/assets/editorial/rotina-web-v1.mp4');
  assert.equal(preview.post.images.length, 1); assert.equal(preview.post.aiGenerated, true);
  f.setSequence(['IN_PROGRESS', 'FINISHED']);
  const result = await f.publisher.run();
  assert.equal(result.status, 'published'); assert.equal(result.aiLabelConfirmed, true);
  const creates = f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media'));
  assert.equal(creates.length, 1); assert.match(creates[0].url, /\/v27\.0\//);
  const fields = new URLSearchParams(creates[0].body);
  assert.equal(fields.get('media_type'), 'REELS'); assert.equal(fields.get('share_to_feed'), 'true');
  assert.equal(fields.get('is_ai_generated'), 'true'); assert.equal(fields.has('image_url'), false);
  assert.equal(fields.get('video_url'), preview.post.videoUrl); assert.match(fields.get('caption'), /IA/);
  assert.equal(f.posts().length, 1);
  const second = fixture({ time: '2026-11-29T19:30:00Z', planFor: editorialPlan });
  assert.match((await second.publisher.preview()).post.videoUrl, /test-drive-web-v1\.mp4$/);
});

test('unapproved videos, absent disclosure and unsupported AI-label API fail before media creation', async () => {
  const unapproved = fixture({ time: '2026-11-22T19:30:00Z',
    planFor: date => ({ ...editorialPlan(date), videoPath: 'https://unapproved.example/video.mp4' }) });
  await assert.rejects(unapproved.publisher.run(), { code: 'editorial_video_not_approved' });
  assert.equal(unapproved.calls.some(call => call.method === 'POST'), false);
  const unlabeled = fixture({ time: '2026-11-22T19:30:00Z', planFor: date => ({ ...editorialPlan(date), aiGenerated: false }) });
  await assert.rejects(unlabeled.publisher.run(), { code: 'editorial_content_invalid' }); assert.equal(unlabeled.posts().length, 0);
  const olderApi = fixture({ time: '2026-11-22T19:30:00Z', planFor: editorialPlan,
    env: { INSTAGRAM_EDITORIAL_GRAPH_VERSION: 'v26.0' } });
  await assert.rejects(olderApi.publisher.run(), { code: 'editorial_ai_label_api_required' }); assert.equal(olderApi.posts().length, 0);
});

test('native AI label status is reported honestly without retrying an already published Reel', async () => {
  const f = fixture({ time: '2026-11-22T19:30:00Z', planFor: editorialPlan, aiLabel: false });
  const result = await f.publisher.run();
  assert.equal(result.status, 'published'); assert.equal(result.aiLabelConfirmed, false); assert.equal(result.reason, 'ai_label_unconfirmed');
  assert.equal((await f.publisher.run()).status, 'already_published'); assert.equal(f.posts().length, 1);
});

test('crossing local midnight during the publication lease cannot publish yesterday or consume two daily slots', async () => {
  const f = fixture({ time: '2026-11-21T23:59:59Z' });
  f.memory.faults.put = (_path, value) => {
    if (value.active?.phase === 'publishing') f.setTime('2026-11-22T00:00:01Z');
    return false;
  };
  const crossed = await f.publisher.run();
  assert.equal(crossed.status, 'skipped'); assert.equal(crossed.reason, 'publication_window_closed');
  assert.equal(crossed.date, '2026-11-21'); assert.equal(f.posts().length, 0);
  assert.equal((await f.publisher.status()).active, null);
  f.memory.faults.put = null; f.setTime('2026-11-22T19:30:00Z');
  const today = await f.publisher.run();
  assert.equal(today.status, 'published'); assert.equal(today.date, '2026-11-22'); assert.equal(f.posts().length, 1);
});

test('same-day recovery resumes the exact Reel container and successful later recovery only deduplicates', async () => {
  const f = fixture({ time: '2026-11-22T19:30:00Z', planFor: editorialPlan });
  f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run({ season: 'winter' })).status, 'preparing');
  const original = JSON.parse(f.memory.records.get(STATE).text).active.containerId;
  const created = () => f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media')).length;
  assert.equal(created(), 1); assert.equal(f.posts().length, 0);
  f.advance(60 * 60_000); f.setContainerStatus('FINISHED');
  assert.equal((await f.publisher.run({ season: 'winter' })).status, 'published');
  assert.equal(created(), 1); assert.equal(f.posts().length, 1);
  assert.equal(new URLSearchParams(f.posts()[0].body).get('creation_id'), original);
  assert.equal((await f.publisher.run({ season: 'winter' })).status, 'already_published');
  assert.equal(created(), 1); assert.equal(f.posts().length, 1);
});

test('validation rejects denied or malformed publication endpoints and reports exhausted quota without posting', async () => {
  const f = fixture(); f.denyLimits(true);
  await assert.rejects(f.publisher.validate(), { code: 'meta_request_failed', metaStatus: 403, metaCode: 10 });
  f.denyLimits(false);
  for (const data of [{ data: [] }, { data: [{ quota_usage: -1, config: { quota_total: 100 } }] },
    { data: [{ quota_usage: 1, config: { quota_total: 0 } }] },
    { data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: '86400' } }] }]) {
    f.setLimits(data);
    await assert.rejects(f.publisher.validate(), { code: 'editorial_publishing_limit_invalid' });
  }
  f.setLimits({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] });
  const exhausted = await f.publisher.validate();
  assert.equal(exhausted.verified, true); assert.equal(exhausted.canPublishNow, false);
  assert.deepEqual(exhausted.publishingQuota, { usage: 100, total: 100, remaining: 0 });
  assert.equal(f.posts().length, 0); assert.equal(f.memory.records.size, 0);
  const facebook = fixture({ env: { INSTAGRAM_LOGIN_MODE: 'facebook' } });
  assert.equal((await facebook.publisher.validate()).verified, true);
  assert.ok(facebook.calls.some(call => /graph\.facebook\.com\/v27\.0\/17841400000000000\/content_publishing_limit/.test(call.url)));
});

test('public post lookup returns only a confirmed safe stored URL without Meta or authorization calls', async () => {
  const f = fixture();
  assert.equal(await f.publisher.postLink('2026-11-21'), null);
  assert.equal(await f.publisher.postLink('../state.json'), null);
  f.setContainerStatus('IN_PROGRESS'); await f.publisher.run();
  assert.equal(await f.publisher.postLink('2026-11-21'), null);
  f.setContainerStatus('FINISHED'); await f.publisher.run();
  const calls = f.calls.length; const tokens = f.tokenResolutions();
  const writes = f.memory.calls.filter(call => call.method === 'put').length;
  assert.equal(await f.publisher.postLink('2026-11-21'), 'https://www.instagram.com/p/EditorialTest01/');
  assert.equal(await f.publisher.postLink('2026-11-22'), null);
  assert.equal(f.calls.length, calls); assert.equal(f.tokenResolutions(), tokens);
  assert.equal(f.memory.calls.filter(call => call.method === 'put').length, writes);
  const stored = f.memory.records.get(STATE); const state = JSON.parse(stored.text);
  state.items['2026-11-21'].permalink = 'https://example.com/not-a-confirmed-instagram-url';
  f.memory.records.set(STATE, { ...stored, text: JSON.stringify(state) });
  assert.equal(await f.publisher.postLink('2026-11-21'), null);
});

const session = hashAdminToken('test-browser-session');
async function reviewExtra(publisher) {
  const { post } = await publisher.extraPreview(session);
  return { extra: true, session, confirmation: { id: post.id, fingerprint: post.fingerprint } };
}

test('extra manual publication is independent of the 19h calendar and deduplicated', async () => {
  const f=fixture({time:'2026-11-21T10:00:00Z'});
  const before=await f.publisher.status(); assert.equal(before.extra.available,true); assert.notEqual(before.extra.nextPost.id,before.nextPost.id);
  const review = await reviewExtra(f.publisher);
  assert.equal(f.calls.length, 0); assert.equal(f.tokenResolutions(), 0);
  const result=await f.publisher.run(review); assert.equal(result.status,'published'); assert.equal(f.posts().length,1);
  const create=f.calls.find(c=>c.method==='POST'&&c.url.endsWith('/media')); assert.equal(new URL(new URLSearchParams(create.body).get('image_url')).searchParams.get('extra'),'1');
  const state=await f.publisher.status(); assert.equal(state.extra.usedToday,true); assert.equal(state.lastResult,null); assert.equal(state.nextPost.date,'2026-11-21'); assert.equal(state.history[0].extra,true);
  await assert.rejects(f.publisher.run(review), { code: 'editorial_review_stale' }); assert.equal(f.posts().length,1);
  assert.equal((await f.publisher.run()).status,'before_schedule');
  f.setTime('2026-11-21T19:01:00Z'); assert.equal((await f.publisher.run()).status,'published'); assert.equal(f.posts().length,2);
  assert.equal((await f.publisher.status()).history.length,2);
});
test('extra cannot consume the last quota reserved for the daily publication',async()=>{
  const f=fixture({time:'2026-11-21T10:00:00Z'}); f.setLimits({data:[{quota_usage:99,config:{quota_total:100}}]});
  assert.equal((await f.publisher.run(await reviewExtra(f.publisher))).reason,'editorial_quota_reserved'); assert.equal(f.posts().length,0); assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('a confirmation is bound to this session, artwork, caption, mode, attempt, and Lisbon day', async () => {
  let titleOverride;
  const f = fixture({ time: '2026-11-21T12:00:00Z', extraPlanFor: day => {
    const extra = adviceEditorialPlan(day, true);
    return titleOverride ? { ...extra, slides: [{ ...extra.slides[0], title: titleOverride }] } : extra;
  } });
  const initial = await reviewExtra(f.publisher);
  await assert.rejects(f.publisher.run({ extra: true }), { code: 'editorial_confirmation_required' });
  await assert.rejects(f.publisher.run({ ...initial, session: hashAdminToken('other-session') }), { code: 'editorial_review_stale' });
  for (const change of [{ id: 'wrong' }, { fingerprint: 'd'.repeat(64) }])
    await assert.rejects(f.publisher.run({ ...initial, confirmation: { ...initial.confirmation, ...change } }),
      { code: 'editorial_review_stale' });
  titleOverride = 'Imagem diferente';
  await assert.rejects(f.publisher.run(initial), { code: 'editorial_review_stale' });
  f.setTime('2026-11-22T09:00:00Z'); titleOverride = undefined;
  await assert.rejects(f.publisher.run(initial), { code: 'editorial_review_stale' });
  assert.equal(f.calls.length, 0);
  f.setTime('2026-11-21T12:01:00Z'); f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run(initial)).status, 'preparing');
  const whilePreparing = await f.publisher.extraPreview(session);
  assert.equal(whilePreparing.mode, 'resume');
  assert.notEqual(whilePreparing.post.fingerprint, initial.confirmation.fingerprint);
  const resume = await reviewExtra(f.publisher);
  await assert.rejects(f.publisher.run(initial), { code: 'editorial_review_stale' });
  f.setContainerStatus('FINISHED');
  assert.equal((await f.publisher.run(resume)).status, 'published');
  assert.equal(f.posts().length, 1);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media')).length, 1);
});

test('retries after definite creation failure need a new confirmation; a prior-day uncertain extra verifies only', async () => {
  const f = fixture({ time: '2026-11-21T11:00:00Z' });
  const original = await reviewExtra(f.publisher);
  f.setFailCreate(true); assert.equal((await f.publisher.run(original)).status, 'failed');
  await assert.rejects(f.publisher.run(original), { code: 'editorial_review_stale' });
  const retry = await reviewExtra(f.publisher);
  assert.notEqual(retry.confirmation.fingerprint, original.confirmation.fingerprint);
  f.setFailCreate(false); f.setFailPublish(true);
  assert.equal((await f.publisher.run(retry)).status, 'review_required');
  f.setTime('2026-11-22T10:00:00Z');
  const pending = await f.publisher.extraPreview(session);
  assert.equal(pending.mode, 'verify'); assert.equal(pending.post.date, '2026-11-21');
  assert.equal((await f.publisher.status()).extra.nextPost.id, pending.post.id);
  const verify = await reviewExtra(f.publisher);
  f.setFailPublish(false); f.setContainerStatus('PUBLISHED');
  const count = f.calls.length;
  assert.equal((await f.publisher.run(verify)).reconciled, true);
  assert.ok(f.calls.slice(count).every(call => call.method === 'GET'));
  assert.equal(f.posts().length, 1);
  const following = await f.publisher.extraPreview(session);
  assert.equal(following.mode, 'publish'); assert.equal(following.post.date, '2026-11-22');
});

test('production prewarming is limited to the next two daily slots and reuses the following draft', async () => {
  let preparations = 0;
  const f = fixture({ time: '2026-11-25T21:00:00Z', planFor: adviceEditorialPlan,
    prepareElectricEdition: async base => { preparations++; return { caption: base.caption, sources: [], copyOrigin: 'editorial' }; } });
  assert.equal(await f.publisher.prepareFollowingEdition('2027-01-01'), null);
  const next = await f.publisher.prepareFollowingEdition('2026-11-26');
  assert.equal(next.date, '2026-11-27');
  f.setTime('2026-11-27T10:00:00Z');
  assert.deepEqual((await f.publisher.preview()).post, next);
  assert.equal(preparations, 1); assert.equal(f.calls.length, 0);
});

test('v3 daily and extra use separate frozen captions, media URLs and history attribution', async () => {
  let prepared = 0;
  const f = fixture({ time: '2026-11-26T17:00:00Z', planFor: adviceEditorialPlan, extraPlanFor: day => adviceEditorialPlan(day, true),
    prepareElectricEdition: async base => { prepared++; return { caption: 'Legenda ' + base.id, sources: [],
      copyOrigin: 'ai', copyModel: 'gpt-6.2-astra' }; } });
  const daily = (await f.publisher.preview()).post, extra = (await f.publisher.extraPreview(session)).post;
  assert.equal(daily.version, 'v3'); assert.equal(extra.version, 'v3');
  assert.notEqual(daily.id, extra.id); assert.notEqual(daily.caption, extra.caption);
  assert.equal(extra.images.length, 1); assert.equal(new URL(extra.images[0]).searchParams.get('extra'), '1');
  assert.equal(daily.copyOrigin, 'ai'); assert.equal(extra.copyModel, 'gpt-6.2-astra');
  assert.equal(f.calls.length, 0); assert.equal(f.tokenResolutions(), 0);
  assert.equal((await f.publisher.run(await reviewExtra(f.publisher))).status, 'published');
  f.setTime('2026-11-26T19:01:00Z');
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(prepared, 2);
  const history = JSON.parse(f.memory.records.get(STATE).text);
  for (const [review, lane] of [[daily, history.items], [extra, history.extraItems]]) {
    assert.equal(lane[review.date].caption, review.caption);
    assert.equal(lane[review.date].version, 'v3');
    assert.equal(lane[review.date].copyOrigin, 'ai');
    assert.equal(lane[review.date].copyModel, 'gpt-6.2-astra');
  }
  assert.equal((await f.publisher.preview(daily.date)).post.caption, daily.caption);
  for (const call of f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media')))
    assert.equal(new URL(new URLSearchParams(call.body).get('image_url')).searchParams.get('v'), 'v3');
});

test('a v2 dated container already preparing survives a v3 calendar deployment with its original frozen content', async () => {
  const time = '2026-11-26T19:02:00Z';
  let count = 0;
  const f = fixture({ time, planFor: scheduledEditorialPlan, prepareElectricEdition: async post => {
    count++; return { caption: 'Legenda v2: ' + post.title, sources: [] };
  } });
  f.setContainerStatus('IN_PROGRESS'); await f.publisher.run();
  f.setPlan(adviceEditorialPlan);
  const viewed = await f.publisher.preview('2026-11-26');
  assert.equal(viewed.post.version, 'v2');
  assert.equal(new URL(viewed.post.images[0]).searchParams.get('v'), 'v2');
  assert.equal((await f.publisher.calendar()).items[0].id, viewed.post.id);
  f.setContainerStatus('FINISHED');
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(count, 1);
  assert.equal((await f.publisher.preview('2026-11-26')).post.caption, viewed.post.caption);
  assert.equal(f.posts().length, 1);
});
test('uncertain extra cannot be repeated or confused with the daily lane',async()=>{
  const f=fixture({time:'2026-11-21T10:00:00Z'}); f.setFailPublish(true);
  const review = await reviewExtra(f.publisher);
  assert.equal((await f.publisher.run(review)).status,'review_required');
  await assert.rejects(f.publisher.run(review), { code: 'editorial_review_stale' }); assert.equal(f.posts().length,1);
  f.setTime('2026-11-21T19:01:00Z');
  assert.equal((await f.publisher.run()).status,'review_required'); assert.equal(f.posts().length,1);
});

test('scheduled slot safely displaces an old, merely preparing extra without publishing it',async()=>{
  const f=fixture({time:'2026-11-21T10:00:00Z'}); f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run(await reviewExtra(f.publisher))).status,'preparing');
  f.setTime('2026-11-21T19:01:00Z'); f.setContainerStatus('FINISHED');
  assert.equal((await f.publisher.run()).status,'published');
  assert.equal(f.posts().length,1); const state=await f.publisher.status();
  assert.equal(state.extra.lastResult.status,'skipped'); assert.equal(state.extra.lastResult.reason,'scheduled_slot_priority');
  assert.equal(state.lastResult.status,'published');
});
test('extra preview and run require the same authenticated browser and an explicit same-origin confirmation', async () => {
  const env = { CRON_SECRET: 'fixture-secret-at-least-32-characters', ADMIN_ACCESS_HASH: '1'.repeat(64),
    ADMIN_SESSION_SECRET: 'fixture-signing-secret-at-least-32-characters' };
  const auth = createAdminSession(env), headers = { cookie: ADMIN_COOKIE_NAME + '=' + auth,
    host: 'autovalorpt-assistente.vercel.app', origin: 'https://autovalorpt-assistente.vercel.app' };
  const fingerprint = '5'.repeat(64), id = 'editorial-extra-test', seen = [];
  const handler = createInstagramEditorialHandler({ env, publisher: {
    extraPreview(session) { seen.push(session); return { ok: true, post: { id, fingerprint } }; },
    run(args) { seen.push(args); return { ok: true, status: 'published', published: 1 }; },
  }, report() {} });
  async function invoke(action, method, headers, body) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await handler({ method, headers, body, query: { action } }, res);
    return res;
  }
  const cron = { authorization: 'Bearer ' + env.CRON_SECRET };
  assert.equal((await invoke('extra-run', 'GET', headers)).code, 403);
  assert.equal((await invoke('extra-run', 'POST', cron)).code, 403);
  assert.equal((await invoke('extra-preview', 'GET', cron)).code, 403);
  assert.equal((await invoke('extra-preview', 'POST', headers)).code, 405);
  assert.equal((await invoke('extra-run', 'POST', { ...headers, origin: 'https://example.com' })).code, 403);
  assert.equal((await invoke('extra-run', 'POST', { ...headers, cookie: '' })).code, 401);
  for (const body of [{}, { confirmation: { id } }, { confirmation: { id, fingerprint: 'bad' } }])
    assert.equal((await invoke('extra-run', 'POST', headers, body)).code, 400);
  assert.deepEqual(seen, []);
  assert.equal((await invoke('extra-preview', 'GET', headers)).code, 200);
  assert.equal((await invoke('extra-run', 'POST', headers, { confirmation: { id, fingerprint } })).code, 200);
  assert.deepEqual(seen, [hashAdminToken(auth), { extra: true, session: hashAdminToken(auth), confirmation: { id, fingerprint } }]);
});

test('upgrading a reviewed v3 extra reuses its exact frozen draft, requires fresh confirmation and sends the v4 captions and artwork in their proper slots', async () => {
  let extraPlanner = adviceEditorialPlan, prepared = 0;
  const date = '2026-11-26';
  const f = fixture({ time: date + 'T07:53:00Z', planFor: adviceEditorialPlan,
    extraPlanFor: day => extraPlanner(day, true),
    prepareElectricEdition: async original => {
      prepared++;
      return { caption: 'Texto da redação sobre ' + original.title + '\n\n' + original.caption,
        sources: [], copyOrigin: 'ai', copyModel: 'gpt-6.2-astra' };
    } });
  const originalExtra = await reviewExtra(f.publisher);
  const originalDaily = (await f.publisher.preview()).post;
  extraPlanner = feedEditorialPlan; f.setPlan(feedEditorialPlan);
  const extra = (await f.publisher.extraPreview(session)).post, daily = (await f.publisher.preview()).post;
  assert.equal(prepared, 2);
  assert.equal(f.calls.length, 0);
  assert.ok(daily.caption.includes(originalDaily.title) && daily.caption.includes('Texto da redação'));
  assert.ok(extra.caption.includes('Texto da redação') && extra.caption.includes('33,26 €') && extra.caption.includes('85,68 €'));
  await assert.rejects(f.publisher.run(originalExtra), { code: 'editorial_review_stale' });
  assert.equal(f.posts().length, 0);
  assert.equal((await f.publisher.run(await reviewExtra(f.publisher))).status, 'published');
  const afterExtra = await f.publisher.status();
  assert.equal(afterExtra.extra.usedToday, true); assert.equal(afterExtra.nextPost.id, daily.id);
  f.setTime(date + 'T19:01:00Z');
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal((await f.publisher.run()).status, 'already_published');
  assert.equal(prepared, 2);
  const create = f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/media'));
  const records = JSON.parse(f.memory.records.get(STATE).text);
  for (const [i, review, record] of [[0, extra, records.extraItems[date]], [1, daily, records.items[date]]]) {
    const params = new URLSearchParams(create[i].body);
    assert.equal(params.get('caption'), review.caption);
    assert.equal(params.get('image_url'), review.images[0]); assert.equal(new URL(review.images[0]).searchParams.get('v'), 'v4');
    assert.ok(params.get('alt_text').includes('https://carregador.vercel.app/'));
    assert.equal(review.caption.split('\n')[0].includes('link do perfil'), true);
    assert.equal(record.caption, review.caption); assert.equal(record.copyModel, 'gpt-6.2-astra');
  }
  assert.equal(create.length, 2);
});

test('the private history offers the sent and suggested captions for an already published v3 extra without consuming another slot or changing its record', async () => {
  let extraPlanner = adviceEditorialPlan;
  const date = '2026-11-26';
  const f = fixture({ time: date + 'T07:53:00Z', planFor: feedEditorialPlan, extraPlanFor: day => extraPlanner(day, true),
    prepareElectricEdition: async post => ({ caption: post.caption, sources: [], copyOrigin: 'editorial' }) });
  const old = (await f.publisher.extraPreview(session)).post;
  await f.publisher.run(await reviewExtra(f.publisher));
  const before = f.memory.records.get(STATE).text;
  extraPlanner = feedEditorialPlan;
  const status = await f.publisher.status();
  assert.equal(status.extra.available, false); assert.equal(status.extra.usedToday, true);
  assert.equal(status.history[0].caption, old.caption);
  assert.equal(status.history[0].suggestedCaption, feedEditorialPlan(date, true).caption);
  assert.equal(f.memory.records.get(STATE).text, before);
  assert.equal(f.posts().length, 1);
});
