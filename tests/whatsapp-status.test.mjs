import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createWhatsappStatus, WHATSAPP_STATUS_PATH, WHATSAPP_STATUS_SECONDS, WHATSAPP_STATUS_COOKIE, WHATSAPP_STATUS_NUMBER } from '../lib/whatsapp-status.js';
import { createWhatsappStatusHandler } from '../lib/whatsapp-status-handler.js';
import { adminRequestAuthorized, createAdminSession, ADMIN_COOKIE_NAME } from '../lib/admin-security.js';
import { storyFingerprint } from '../lib/instagram-stories.js';
import { instagramVideoPath } from '../lib/instagram-video-access.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const HASH = value => createHash('sha256').update(value).digest('hex');
const env = { VERCEL_ENV: 'production', ADMIN_ACCESS_HASH: 'a'.repeat(64), ADMIN_SESSION_SECRET: 'private-test-secret-'.repeat(3),
  INSTAGRAM_USER_ID: '12345678', INSTAGRAM_RETIREMENTS_USER_ID: '23456789', INSTAGRAM_RETIREMENTS_PAGE_ID: '34567890', INSTAGRAM_FEED_URL: 'https://example.test/feed.csv' };
const car = (suffix, price = '12500 EUR') => ({ id: `IDabcde${suffix}`, title: `Carro ${suffix}`, description: 'Gasolina', availability: 'in stock', condition: 'used', price, link: `https://www.standvirtual.com/carros/anuncio/car-IDabcde${suffix}.html`, image_link: 'https://images.example.test/car.jpg', brand: 'Marca' });
const rejection = code => error => error.code === code;

async function fixture() {
  const mem = memoryBlob(); let clock = Date.parse('2026-11-14T08:15:00.000Z');
  let items = [car('1'), car('2'), car('3')]; let outOfStockIds = []; let sources = []; let valid = true; let sourceHook;
  const baseHead = mem.storage.head;
  mem.storage.head = async (...args) => {
    if (args[0].endsWith('.mp4') && !mem.records.has(args[0])) throw Object.assign(new Error('Missing file'), { status: 404 });
    return { ...await baseHead(...args), ...(args[0].endsWith('.mp4') ? { contentType: 'video/mp4', size: 1200 } : {}) };
  };
  const source = { audit: async () => { if (sourceHook) await sourceHook(); return { valid, items, sources, outOfStockIds, expectedCount: items.length, sourceCount: items.length, checkedAt: new Date(clock).toISOString() }; } };
  const settings = { env, storage: mem.storage, source, now: () => clock };
  const service = createWhatsappStatus(settings);
  async function stories(values = items, extra = {}) {
    const entries = {};
    for (const [index, item] of values.entries()) {
      const fingerprint = storyFingerprint(item); const path = instagramVideoPath(item.id, fingerprint);
      mem.records.set(path, { etag: `video-${item.id}-${fingerprint}`, text: 'v'.repeat(1200) });
      entries[item.id] = { status: 'published', instagramMediaId: `1234567${index}`, fingerprint, videoPath: path, at: new Date(clock - (values.length - index) * 1000).toISOString(), bytes: 1200 };
    }
    mem.records.set('instagram/v1/production/stories.json', { etag: `stories-${clock}`, text: JSON.stringify({ version: 1, accountId: env.INSTAGRAM_USER_ID, facebookId: env.INSTAGRAM_RETIREMENTS_USER_ID,
      pageId: env.INSTAGRAM_RETIREMENTS_PAGE_ID, sourceHash: HASH(env.INSTAGRAM_FEED_URL), publicationProvider: 'instagram', items: entries, ...extra }) });
  }
  await stories();
  const enrolled = await service.enroll({ admin: true });
  const token = enrolled.cookie.split(';')[0].split('=')[1]; const context = { token };
  const plan = () => service.plan(context);
  const claim = async () => { const next = (await plan()).candidate; return service.claim(context, next); };
  const confirm = async active => service.confirm(context, { attemptId: active.attemptId, id: active.id, fingerprint: active.fingerprint,
    account: WHATSAPP_STATUS_NUMBER, visibleInMyStatus: true, observedAt: new Date(clock).toISOString(), observation: `${active.title}, ${active.price}, visível em O meu estado.` });
  return { ...mem, service, settings, context, enrolled, plan, claim, confirm, stories,
    get items() { return items; }, set items(value) { items = value; },
    get outOfStockIds() { return outOfStockIds; }, set outOfStockIds(value) { outOfStockIds = value; },
    set sources(value) { sources = value; },
    set valid(value) { valid = value; }, set clock(value) { clock = value; }, get clock() { return clock; },
    set sourceHook(value) { sourceHook = value; }, state: () => JSON.parse(mem.records.get(WHATSAPP_STATUS_PATH).text) };
}

test('device capability is 90 days, HttpOnly, revocable and never an admin credential', async () => {
  const f = await fixture(); const publicData = JSON.stringify(f.enrolled.data);
  assert.match(f.enrolled.cookie, /Max-Age=7776000; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(Date.parse(f.enrolled.data.device.expiresAt) - Date.parse(f.enrolled.data.device.createdAt), WHATSAPP_STATUS_SECONDS * 1000);
  assert.equal(publicData.includes(f.context.token), false); assert.equal(publicData.includes('tokenHash'), false); assert.equal(publicData.includes('accessBinding'), false);
  assert.equal(adminRequestAuthorized({ headers: { cookie: `${WHATSAPP_STATUS_COOKIE}=${f.context.token}` } }, env, f.clock), false);
  assert.equal(adminRequestAuthorized({ headers: { cookie: `${ADMIN_COOKIE_NAME}=${f.context.token}` } }, env, f.clock), false);
  await assert.rejects(f.service.enroll(f.context), rejection('status_unauthorized'));
  await assert.rejects(f.service.revoke(f.context), rejection('status_unauthorized'));
  await assert.rejects(f.service.enroll({ admin: true }), rejection('status_device_exists'));
  await f.service.revoke({ admin: true });
  await assert.rejects(f.service.status(f.context), rejection('status_unauthorized'));
  const replacement = await f.service.enroll({ admin: true }); assert.notEqual(replacement.cookie, f.enrolled.cookie);
});

test('expiry and admin secret rotation invalidate device access', async () => {
  const f = await fixture();
  const rotated = createWhatsappStatus({ ...f.settings, env: { ...env, ADMIN_SESSION_SECRET: 'changed'.repeat(10) } });
  await assert.rejects(rotated.status(f.context), rejection('status_unauthorized'));
  f.clock += WHATSAPP_STATUS_SECONDS * 1000;
  await assert.rejects(f.service.status(f.context), rejection('status_unauthorized'));
  assert.equal((await f.service.status({ admin: true })).device.valid, false);
});

test('read-only plan chooses latest eligible existing video; claim baselines other stock without IG writes', async () => {
  const f = await fixture(); const before = f.calls.filter(call => call.method === 'put').length;
  const p = await f.plan(); assert.equal(p.candidate.id, f.items[2].id); assert.equal(p.wouldInitializeBaseline, true);
  assert.equal(f.calls.filter(call => call.method === 'put').length, before);
  const result = await f.claim(); assert.equal(result.active.phase, 'reserved');
  assert.equal(f.state().items[f.items[0].id].status, 'baseline');
  assert.equal(f.state().items[f.items[1].id].status, 'baseline');
  assert.equal(f.state().items[f.items[2].id].status, 'reserved');
  assert.deepEqual(new Set(f.calls.filter(call => call.method === 'put').map(call => call.path)), new Set([WHATSAPP_STATUS_PATH]));
  await assert.rejects(f.service.claim(f.context, p.candidate), rejection('status_attempt_pending'));
  assert.equal((await f.plan()).candidate, null);
});

test('fresh source and exact fingerprint are required for reservation, media and begin', async () => {
  const f = await fixture(); const next = (await f.plan()).candidate;
  await assert.rejects(f.service.claim(f.context, { ...next, fingerprint: 'f'.repeat(64) }), rejection('status_candidate_changed'));
  f.valid = false; await assert.rejects(f.plan(), rejection('status_source_unverified')); f.valid = true;
  const result = await f.claim(); const active = result.active;
  const media = await f.service.media(f.context, { attemptId: active.attemptId }); assert.equal((await new Response(media.stream).text()).length, 1200);
  f.items = f.items.map(item => item.id === active.id ? { ...item, price: '19000 EUR' } : item);
  await assert.rejects(f.service.media(f.context, { attemptId: active.attemptId }), rejection('status_video_changed'));
  await assert.rejects(f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER }), rejection('status_video_changed'));
  assert.equal(f.state().active.phase, 'reserved');
});

test('WhatsApp validates the row while streaming an immutable shared gallery asset', async () => {
  const f = await fixture(); const latest = f.items[2]; const legacy = instagramVideoPath(latest.id, storyFingerprint(latest));
  const blob = f.records.get('instagram/v1/production/stories.json'); const state = JSON.parse(blob.text);
  const entry = state.items[latest.id]; entry.assetFingerprint = 'b'.repeat(64);
  entry.videoPath = instagramVideoPath(latest.id, entry.assetFingerprint);
  f.records.set(entry.videoPath, f.records.get(legacy)); f.records.delete(legacy);
  blob.text = JSON.stringify(state);
  const { active } = await f.claim();
  assert.equal(active.fingerprint, storyFingerprint(latest));
  const media = await f.service.media(f.context, { attemptId: active.attemptId });
  assert.equal((await new Response(media.stream).text()).length, 1200);
});

test('candidate rejects untrusted IG binding and unpublished videos and skips missing assets', async () => {
  const f = await fixture();
  await f.stories(f.items, { accountId: 'another-account' });
  await assert.rejects(f.plan(), rejection('status_video_binding_changed'));
  await f.stories();
  const blob = f.records.get('instagram/v1/production/stories.json'); const ig = JSON.parse(blob.text);
  for (const entry of Object.values(ig.items)) entry.status = 'preview_ready';
  blob.text = JSON.stringify(ig); assert.equal((await f.plan()).candidate, null);
  await f.stories(); const latest = f.items[2]; f.records.delete(instagramVideoPath(latest.id, storyFingerprint(latest)));
  const fallback = await f.plan();
  assert.equal(fallback.candidate.id, f.items[1].id);
  assert.equal(fallback.pendingVideoCount, 1);
  const claimed = await f.service.claim(f.context, fallback.candidate);
  assert.equal(claimed.active.id, f.items[1].id);
  assert.equal(f.state().items[latest.id], undefined);
});

test('concurrent reservations permit exactly one attempt', async () => {
  const f = await fixture(); const next = (await f.plan()).candidate;
  const results = await Promise.allSettled([f.service.claim(f.context, next), f.service.claim(f.context, next)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'status_conflict');
  assert.equal(f.state().active.id, next.id);
});

test('revocation during reservation wins and cannot be overwritten', async () => {
  const f = await fixture(); const next = (await f.plan()).candidate;
  let unblock; let started; const entered = new Promise(resolve => { started = resolve; });
  f.sourceHook = () => new Promise(resolve => { unblock = resolve; started(); });
  const pending = f.service.claim(f.context, next); await entered;
  await f.service.revoke({ admin: true }); unblock();
  await assert.rejects(pending, rejection('status_conflict'));
  assert.ok(f.state().device.revokedAt); assert.equal(f.state().active, null);
});

test('publication needs begin marker and explicit observation; records no API proof and enforces daily cap', async () => {
  const f = await fixture(); const active = (await f.claim()).active;
  await assert.rejects(f.confirm(active), rejection('status_publication_not_started'));
  await assert.rejects(f.service.begin(f.context, { attemptId: active.attemptId, account: '+351000000000' }), rejection('status_account_unverified'));
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await assert.rejects(f.service.confirm(f.context, { attemptId: active.attemptId }), rejection('status_observation_required'));
  await assert.rejects(f.service.media(f.context, { attemptId: active.attemptId }), rejection('status_attempt_pending'));
  const result = await f.confirm(active);
  assert.equal(result.lastResult.status, 'observed_published'); assert.equal(result.lastResult.providerApiVerified, false);
  assert.equal(result.automation, 'publication_observed_scheduled_test_pending'); assert.equal(result.active, null);
  assert.equal((await f.plan()).reason, 'status_daily_limit');
  await assert.rejects(f.confirm(active), rejection('status_attempt_mismatch'));
});

test('unknown attempt never retries automatically, including after time passes or revocation', async () => {
  const f = await fixture(); const active = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await f.service.uncertain(f.context, { attemptId: active.attemptId }); f.clock += 3 * 86400_000;
  assert.equal((await f.plan()).reason, 'status_attempt_pending');
  await assert.rejects(f.service.claim(f.context, active), rejection('status_attempt_pending'));
  await f.service.revoke({ admin: true });
  await assert.rejects(f.service.enroll({ admin: true }), rejection('status_attempt_pending'));
  assert.equal(f.state().active.phase, 'unknown');
  await f.service.close({ admin: true }, { attemptId: active.attemptId, doNotRepeat: true });
  assert.equal(f.state().items[active.id].status, 'closed_without_publication_confirmation');
  assert.equal(f.state().lastResult.providerApiVerified, false);
});

test('processed and baseline IDs never requeue when removed, reappeared or changed; new IDs can queue next day', async () => {
  const f = await fixture(); const active = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER }); await f.confirm(active);
  f.clock += 86400_000; const original = f.items;
  f.items = original.slice(0, 2); await f.stories(); assert.equal((await f.plan()).candidate, null);
  f.items = original.map(item => ({ ...item, price: '9900 EUR' })); await f.stories(); assert.equal((await f.plan()).candidate, null);
  f.items.push(car('4')); await f.stories(); assert.equal((await f.plan()).candidate.id, 'IDabcde4');
});

test('new vehicles from either inventory stay queued through Instagram expiry and are served in order across days', async () => {
  const f = await fixture();
  const baseline = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: baseline.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await f.confirm(baseline);
  f.clock += 2 * 86400_000;
  const first = car('4'), second = car('5'), pending = car('6');
  f.items = [...f.items, first, second, pending];
  f.sources = [{ id: 'autovalorpt', ids: [first.id, pending.id] }, { id: 'samucar', ids: [second.id] }];
  await f.stories(f.items.filter(item => item.id !== pending.id));
  const blob = f.records.get('instagram/v1/production/stories.json');
  const ledger = JSON.parse(blob.text);
  ledger.items[first.id].status = 'expired';
  ledger.items[first.id].at = new Date(f.clock - 86400_000).toISOString();
  ledger.items[second.id].status = 'mapping_pending';
  ledger.items[second.id].mappingStatus = 'pending';
  blob.text = JSON.stringify(ledger);
  const plan = await f.plan();
  assert.equal(plan.pendingCount, 3);
  assert.equal(plan.pendingVideoCount, 1);
  assert.equal(plan.candidate.id, first.id);
  assert.deepEqual(plan.candidate.sourceNames, ['AutoValorPT']);
  const { active } = await f.service.claim(f.context, plan.candidate);
  const media = await f.service.media(f.context, { attemptId: active.attemptId });
  assert.equal((await new Response(media.stream).text()).length, 1200);
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER });
  const confirmed = await f.service.confirm(f.context, { attemptId: active.attemptId, id: active.id, fingerprint: active.fingerprint,
    account: WHATSAPP_STATUS_NUMBER, visibleInMyStatus: true, observedAt: new Date(f.clock).toISOString(),
    observationClient: 'whatsapp', observation: 'Preço e viatura visíveis no Estado do WhatsApp Business.' });
  assert.equal(confirmed.lastResult.confirmationSource, 'whatsapp_observation');
  assert.equal(confirmed.lastResult.providerApiVerified, false);
  assert.equal((await f.plan()).reason, 'status_daily_limit');
  f.clock += 86400_000;
  const next = await f.plan();
  assert.equal(next.candidate.id, second.id);
  assert.deepEqual(next.candidate.sourceNames, ['Samucar']);
  assert.equal(next.pendingCount, 2);
  f.items = f.items.filter(item => item.id !== second.id);
  await assert.rejects(f.service.claim(f.context, next.candidate), rejection('status_candidate_changed'));
});

test('expired media cannot bootstrap an old stock backlog and unconfirmed or changed stories stay ineligible', async () => {
  const f = await fixture();
  const blob = f.records.get('instagram/v1/production/stories.json');
  const state = JSON.parse(blob.text);
  for (const entry of Object.values(state.items)) entry.status = 'expired';
  blob.text = JSON.stringify(state);
  assert.equal((await f.plan()).candidate, null);
  for (const entry of Object.values(state.items)) {
    entry.status = 'mapping_pending'; entry.instagramMediaId = '';
  }
  blob.text = JSON.stringify(state); assert.equal((await f.plan()).candidate, null);
  const first = state.items[f.items[0].id]; first.instagramMediaId = '12345678'; first.provider = 'facebook';
  blob.text = JSON.stringify(state); assert.equal((await f.plan()).candidate, null);
  first.provider = 'instagram'; first.fingerprint = 'd'.repeat(64);
  blob.text = JSON.stringify(state); assert.equal((await f.plan()).candidate, null);
});

test('the vehicle queue skips broken archive files, checks only until the first usable one, and retries restored assets in order', async () => {
  const f = await fixture();
  const initial = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: initial.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await f.confirm(initial);
  f.clock += 86400_000;
  const cars = ['4','5','6','7','8'].map(suffix => car(suffix));
  f.items.push(...cars); await f.stories();
  const storyBlob = f.records.get('instagram/v1/production/stories.json'), original = storyBlob.text;
  const ledger = JSON.parse(original), first = ledger.items[cars[0].id];
  first.videoPath = 'unexpected/example.mp4';
  ledger.items[cars[1].id].assetFingerprint = 'invalid';
  storyBlob.text = JSON.stringify(ledger);
  const previousHead = f.storage.head, videoHeads = [];
  f.storage.head = async (path, options) => {
    const meta = await previousHead(path, options);
    if (path.endsWith('.mp4')) videoHeads.push(path);
    if (path.includes(cars[2].id)) meta.size = 0;
    if (path.includes(cars[3].id)) meta.contentType = 'image/jpeg';
    return meta;
  };
  const selected = await f.plan();
  assert.equal(selected.candidate.id, cars[4].id);
  assert.equal(selected.pendingCount, 5); assert.equal(selected.pendingVideoCount, 4);
  assert.equal(videoHeads.length, 3);
  const originalHead = f.storage.head;
  f.storage.head = (path, options) => {
    if (path.includes(cars[2].id)) throw Object.assign(new Error('storage timeout'), { status: 503 });
    return originalHead(path, options);
  };
  await assert.rejects(f.plan(), /storage timeout/);
  storyBlob.text = original; videoHeads.length = 0;
  const restored = await f.plan(); assert.equal(restored.candidate.id, cars[0].id);
  assert.equal(videoHeads.length, 1);
  assert.equal(f.state().items[cars[0].id], undefined);
});

test('bootstrap rejects old published entries even if the Instagram ledger has yet to run its expiry pass', async () => {
  const f = await fixture();
  f.clock += 2 * 86400_000;
  const plan = await f.plan();
  assert.equal(plan.candidate, null); assert.equal(plan.pendingCount, 0); assert.equal(plan.pendingVideoCount, 0);
});

test('an uncertain or manually closed send consumes the day even after device replacement', async () => {
  const f = await fixture(); const active = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await f.service.uncertain(f.context, { attemptId: active.attemptId });
  await f.service.close({ admin: true }, { attemptId: active.attemptId, doNotRepeat: true });
  f.items.push(car('4')); await f.stories();
  assert.equal((await f.plan()).reason, 'status_daily_limit');
  await assert.rejects(f.service.claim(f.context, { id: 'IDabcde4' }), rejection('status_daily_limit'));
  await f.service.revoke({ admin: true }); const enrolled = await f.service.enroll({ admin: true });
  const replacement = { token: enrolled.cookie.split(';')[0].split('=')[1] };
  assert.equal((await f.service.plan(replacement)).reason, 'status_daily_limit');
  f.clock += 86400_000;
  assert.equal((await f.service.plan(replacement)).candidate.id, 'IDabcde4');
});

test('storage uncertainty fails closed without a second attempt', async () => {
  const f = await fixture(); const next = (await f.plan()).candidate;
  f.faults.put = () => true;
  await assert.rejects(f.service.claim(f.context, next), rejection('status_storage_unavailable'));
  assert.equal(f.state().active, null);
  f.faults.put = null; const active = (await f.claim()).active;
  f.faults.put = () => true;
  await assert.rejects(f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER }), rejection('status_storage_unavailable'));
  assert.equal(f.state().active.phase, 'reserved');
});

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
test('router enforces same-origin POST, rejects broad actions and never accepts cron or device as admin', async () => {
  const f = await fixture(); const handler = createWhatsappStatusHandler(f.settings);
  const request = (action, method = 'POST', headers = {}) => ({ method, query: { action }, body: {}, headers: { host: 'autovalorpt.vercel.app', origin: 'https://autovalorpt.vercel.app', cookie: `${WHATSAPP_STATUS_COOKIE}=${f.context.token}`, ...headers } });
  for (const [req, expected] of [
    [request('revoke', 'GET'), 405], [request('claim', 'POST', { origin: 'https://evil.test' }), 403],
    [request('claim', 'POST', { origin: undefined }), 403], [request('claim', 'POST', { origin: 'http://autovalorpt.vercel.app' }), 403],
    [request('revoke'), 401], [request('enroll'), 401], [request('sync'), 400],
    [request('status', 'GET', { cookie: '', authorization: 'Bearer cron-token' }), 401],
  ]) { const res = response(); await handler(req, res); assert.equal(res.statusCode, expected); assert.match(res.headers['Cache-Control'], /no-store/); }
  const res = response(); await handler(request('status', 'GET'), res); assert.equal(res.statusCode, 200); assert.equal(res.body.role, 'device');
  const admin = createAdminSession(env, Date.now()); const revoke = response();
  await handler(request('revoke', 'POST', { cookie: `${ADMIN_COOKIE_NAME}=${admin}` }), revoke); assert.equal(revoke.statusCode, 200); assert.match(revoke.headers['Set-Cookie'], /Max-Age=0/);
});

test('UI exposes scope, expiry, manual sending and observed-only evidence without embedding secrets', async () => {
  const html = await readFile(new URL('../estado-whatsapp.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../estado-whatsapp.js', import.meta.url), 'utf8');
  assert.match(html, /90 dias/); assert.match(html, /envio final é feito em «O meu estado»/); assert.match(html, /Não é uma confirmação recebida da API/);
  assert.match(js, /visibleInMyStatus/); assert.match(js, /doNotRepeat: true/);
  assert.doesNotMatch(html + js, /ADMIN_SESSION_SECRET|tokenHash|localStorage|innerHTML|Bearer/);
});

async function observedFixture() {
  const f = await fixture();
  f.publication = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: f.publication.attemptId, account: WHATSAPP_STATUS_NUMBER });
  await f.confirm(f.publication);
  f.originalPublication = structuredClone(f.state().items[f.publication.id]);
  return f;
}
function removeObservedCar(f) {
  f.items = f.items.filter(item => item.id !== f.publication.id);
  f.outOfStockIds = [f.publication.id];
}
async function reserveWithdrawal(f) {
  const plan = await f.service.withdrawalPlan(f.context);
  assert.equal(plan.candidates.length, 1);
  return (await f.service.withdrawalClaim(f.context, plan.candidates[0])).active;
}
function withdrawalEvidence(f, active, overrides = {}) {
  return { attemptId: active.attemptId, id: active.id, fingerprint: active.fingerprint,
    publicationAttemptId: active.publicationAttemptId, account: WHATSAPP_STATUS_NUMBER,
    visibleInMyStatus: true, identityUnambiguous: true, observedAt: new Date(f.clock).toISOString(),
    observation: `Identifiquei o vídeo ${active.id} com o carro e preço originais em O meu estado.`, ...overrides };
}
const statusRejection = error => /^status_/.test(error?.code || '');

test('withdrawal plan requires explicit removal or changed data, never mere absence, and performs no writes', async () => {
  const f = await observedFixture();
  const writes = f.calls.filter(call => call.method === 'put').length;
  f.items = f.items.filter(item => item.id !== f.publication.id);
  assert.deepEqual((await f.service.withdrawalPlan(f.context)).candidates, []);
  f.outOfStockIds = [f.publication.id];
  // A broken Instagram ledger must not conceal a withdrawal of our own
  // independently recorded, visually confirmed WhatsApp State.
  f.records.delete('instagram/v1/production/stories.json');
  const plan = await f.service.withdrawalPlan(f.context);
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].id, f.publication.id);
  assert.equal(plan.candidates[0].fingerprint, f.publication.fingerprint);
  assert.equal(plan.candidates[0].publicationAttemptId, f.publication.attemptId);
  assert.equal(f.calls.filter(call => call.method === 'put').length, writes);
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
  f.valid = false;
  await assert.rejects(f.service.withdrawalPlan(f.context), rejection('status_source_unverified'));
});

test('withdrawal reservation and begin revalidate the exact old publication and current price', async () => {
  const f = await observedFixture(); const originalItems = f.items;
  f.items = f.items.map(item => item.id === f.publication.id ? { ...item, price: '16000 EUR' } : item);
  const candidate = (await f.service.withdrawalPlan(f.context)).candidates[0];
  await assert.rejects(f.service.withdrawalClaim(f.context, { ...candidate, fingerprint: 'f'.repeat(64) }), statusRejection);
  await assert.rejects(f.service.withdrawalClaim(f.context, { ...candidate, publicationAttemptId: 'different' }), statusRejection);
  const active = (await f.service.withdrawalClaim(f.context, candidate)).active;
  assert.equal(active.kind, 'withdrawal'); assert.equal(active.phase, 'reserved');
  assert.equal((await f.plan()).reason, 'status_attempt_pending');
  f.items = originalItems;
  await assert.rejects(f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active)), statusRejection);
  assert.equal(f.state().active.phase, 'reserved');
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
});

test('elapsed 24 hour visibility is not evidence of deletion and is never queued for removal', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const writes = f.calls.filter(call => call.method === 'put').length;
  f.clock += 24 * 3600_000;
  const plan = await f.service.withdrawalPlan(f.context);
  assert.equal(plan.candidates.length, 0);
  assert.equal(plan.elapsed.length, 1);
  assert.equal(plan.elapsed[0].id, f.publication.id);
  assert.equal(plan.elapsed[0].status, 'window_elapsed');
  assert.equal(plan.elapsed[0].deletionConfirmed, false);
  assert.equal(f.calls.filter(call => call.method === 'put').length, writes);
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
  assert.equal(f.state().lastWithdrawalResult, undefined);
});

test('a replacement device cannot withdraw a State owned by the former device', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const candidate = (await f.service.withdrawalPlan(f.context)).candidates[0];
  await assert.rejects(f.service.withdrawalClaim({ admin: true }, candidate), rejection('status_unauthorized'));
  await f.service.revoke({ admin: true });
  await assert.rejects(f.service.withdrawalPlan(f.context), rejection('status_unauthorized'));
  const enrolled = await f.service.enroll({ admin: true });
  const replacement = { token: enrolled.cookie.split(';')[0].split('=')[1] };
  assert.equal((await f.service.withdrawalPlan(replacement)).candidates.length, 0);
  await assert.rejects(f.service.withdrawalClaim(replacement, candidate), statusRejection);
  assert.equal(f.state().active, null);
  assert.equal((await f.service.status(replacement)).automation, 'pending_end_to_end_test');
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
});

test('withdrawal confirmation requires a begun, unambiguous visual delete and preserves publication evidence', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const active = await reserveWithdrawal(f); const daily = f.state().lastStartedDay;
  const confirmation = overrides => withdrawalEvidence(f, active, { deletionActionObserved: true, absentFromMyStatus: true, ...overrides });
  await assert.rejects(f.service.withdrawalConfirm(f.context, confirmation()), statusRejection);
  for (const invalid of [{ visibleInMyStatus: false }, { identityUnambiguous: false }, { account: '+351000000000' },
    { fingerprint: 'f'.repeat(64) }, { observation: 'too short' }, { observedAt: new Date(f.clock - 11 * 60_000).toISOString() }]) {
    await assert.rejects(f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active, invalid)), statusRejection);
  }
  await f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active));
  assert.equal(f.state().active.phase, 'deleting');
  assert.ok(f.state().active.deletionStartedAt);
  await assert.rejects(f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER }), statusRejection);
  await assert.rejects(f.confirm(active), statusRejection);
  await assert.rejects(f.service.media(f.context, { attemptId: active.attemptId }), statusRejection);
  for (const invalid of [{ deletionActionObserved: false }, { absentFromMyStatus: false }, { account: '+351000000000' },
    { publicationAttemptId: 'different' }, { observation: 'too short' }, { observedAt: new Date(f.clock - 1).toISOString() }]) {
    await assert.rejects(f.service.withdrawalConfirm(f.context, confirmation(invalid)), statusRejection);
  }
  f.clock += 1000;
  const result = await f.service.withdrawalConfirm(f.context, confirmation());
  assert.equal(result.active, null);
  assert.equal(result.lastWithdrawalResult.status, 'observed_removed');
  assert.equal(result.lastWithdrawalResult.providerApiVerified, false);
  const stored = f.state().items[f.publication.id];
  assert.equal(stored.withdrawal.status, 'observed_removed');
  const { withdrawal, ...publication } = stored;
  assert.deepEqual(publication, f.originalPublication);
  assert.deepEqual(f.state().lastResult, f.originalPublication);
  assert.equal(f.state().lastStartedDay, daily);
  assert.equal((await f.plan()).reason, 'status_daily_limit');
  assert.equal((await f.service.withdrawalPlan(f.context)).candidates.length, 0);
  await assert.rejects(f.service.withdrawalConfirm(f.context, confirmation()), statusRejection);
});

test('uncertain or closed withdrawals never repeat and never erase or imply publication removal', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const active = await reserveWithdrawal(f);
  await f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active));
  await f.service.uncertain(f.context, { attemptId: active.attemptId });
  f.clock += 60_000;
  assert.equal(f.state().active.phase, 'unknown');
  assert.equal(f.state().items[f.publication.id].status, 'observed_published');
  assert.equal((await f.service.withdrawalPlan(f.context)).candidates.length, 0);
  await assert.rejects(f.service.withdrawalClaim(f.context, { id: active.id, fingerprint: active.fingerprint, publicationAttemptId: active.publicationAttemptId }), statusRejection);
  await f.service.close({ admin: true }, { attemptId: active.attemptId, doNotRepeat: true });
  const stored = f.state().items[f.publication.id];
  assert.equal(stored.status, 'observed_published');
  assert.equal(stored.withdrawal.status, 'closed_without_removal_confirmation');
  assert.equal(f.state().lastWithdrawalResult.providerApiVerified, false);
  assert.equal(f.state().active, null);
  assert.equal((await f.service.withdrawalPlan(f.context)).candidates.length, 0);
  assert.equal((await f.plan()).reason, 'status_daily_limit');
  assert.deepEqual(f.state().lastResult, f.originalPublication);
});

test('concurrent withdrawal reservations and revocation cannot overwrite publication proof', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const candidate = (await f.service.withdrawalPlan(f.context)).candidates[0];
  const results = await Promise.allSettled([f.service.withdrawalClaim(f.context, candidate), f.service.withdrawalClaim(f.context, candidate)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'status_conflict');
  const active = f.state().active;
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
  await f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active));
  await f.service.revoke({ admin: true });
  assert.equal(f.state().active.phase, 'unknown');
  assert.equal(f.state().items[f.publication.id].status, 'observed_published');
  await assert.rejects(f.service.withdrawalConfirm(f.context, withdrawalEvidence(f, active, { deletionActionObserved: true, absentFromMyStatus: true })), rejection('status_unauthorized'));
  await assert.rejects(f.service.enroll({ admin: true }), rejection('status_attempt_pending'));
});

test('revocation during withdrawal reservation wins its CAS race', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const candidate = (await f.service.withdrawalPlan(f.context)).candidates[0];
  let unblock; let started; const entered = new Promise(resolve => { started = resolve; });
  f.sourceHook = () => new Promise(resolve => { unblock = resolve; started(); });
  const pending = f.service.withdrawalClaim(f.context, candidate); await entered;
  await f.service.revoke({ admin: true }); unblock();
  await assert.rejects(pending, rejection('status_conflict'));
  assert.ok(f.state().device.revokedAt);
  assert.equal(f.state().active, null);
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
});

test('withdrawal begin rejects newly unverified stock and an elapsed visibility window', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const active = await reserveWithdrawal(f);
  f.valid = false;
  await assert.rejects(f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active)), rejection('status_source_unverified'));
  f.valid = true; f.clock += 24 * 3600_000;
  await assert.rejects(f.service.withdrawalBegin(f.context, withdrawalEvidence(f, active)), statusRejection);
  assert.equal(f.state().active.phase, 'reserved');
  assert.deepEqual(f.state().items[f.publication.id], f.originalPublication);
});

test('withdrawal routes keep read-only plan and same-origin restricted device mutations separate', async () => {
  const f = await observedFixture(); removeObservedCar(f);
  const handler = createWhatsappStatusHandler(f.settings);
  const req = (action, method, headers = {}, body = {}) => ({ method, query: { action }, body,
    headers: { host: 'autovalorpt.vercel.app', origin: 'https://autovalorpt.vercel.app', cookie: `${WHATSAPP_STATUS_COOKIE}=${f.context.token}`, ...headers } });
  const plan = response(); await handler(req('withdrawal-plan', 'GET'), plan);
  assert.equal(plan.statusCode, 200); assert.equal(plan.body.candidates.length, 1);
  for (const [request, expected] of [
    [req('withdrawal-plan', 'POST'), 405], [req('withdrawal-begin', 'GET'), 405],
    [req('withdrawal-claim', 'POST', { origin: 'https://evil.test' }, plan.body.candidates[0]), 403],
    [req('withdrawal-plan', 'GET', { cookie: '' }), 401],
    [req('withdrawal-claim', 'POST', { cookie: `${ADMIN_COOKIE_NAME}=${createAdminSession(env, Date.now())}` }, plan.body.candidates[0]), 401],
  ]) { const res = response(); await handler(request, res); assert.equal(res.statusCode, expected); }
  assert.equal(f.state().active, null);
});

test('late publication confirmation does not extend the 24 hour withdrawal selection window', async () => {
  const f = await fixture(); const active = (await f.claim()).active;
  await f.service.begin(f.context, { attemptId: active.attemptId, account: WHATSAPP_STATUS_NUMBER });
  const begun = f.clock;
  f.clock += 2 * 60 * 60_000; await f.confirm(active);
  f.items = f.items.filter(item => item.id !== active.id); f.outOfStockIds = [active.id];
  f.clock = begun + 24 * 60 * 60_000;
  const result = await f.service.withdrawalPlan(f.context);
  assert.equal(result.candidates.length, 0); assert.equal(result.elapsed[0].windowFrom, 'publication_started');
  assert.equal(result.elapsed[0].deletionConfirmed, false);
  assert.equal(f.state().items[active.id].status, 'observed_published');
});
