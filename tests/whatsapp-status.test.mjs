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
  let items = [car('1'), car('2'), car('3')]; let valid = true; let sourceHook;
  const baseHead = mem.storage.head;
  mem.storage.head = async (...args) => ({ ...await baseHead(...args), ...(args[0].endsWith('.mp4') ? { contentType: 'video/mp4', size: 1200 } : {}) });
  const source = { audit: async () => { if (sourceHook) await sourceHook(); return { valid, items, expectedCount: items.length, sourceCount: items.length, checkedAt: new Date(clock).toISOString() }; } };
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

test('candidate rejects untrusted IG binding, unpublished video and missing assets', async () => {
  const f = await fixture();
  await f.stories(f.items, { accountId: 'another-account' });
  await assert.rejects(f.plan(), rejection('status_video_binding_changed'));
  await f.stories();
  const blob = f.records.get('instagram/v1/production/stories.json'); const ig = JSON.parse(blob.text);
  for (const entry of Object.values(ig.items)) entry.status = 'preview_ready';
  blob.text = JSON.stringify(ig); assert.equal((await f.plan()).candidate, null);
  await f.stories(); const latest = f.items[2]; f.records.delete(instagramVideoPath(latest.id, storyFingerprint(latest)));
  await assert.rejects(f.plan());
  assert.equal(f.state().active, null);
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
  assert.equal(result.automation, 'pending_end_to_end_test'); assert.equal(result.active, null);
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

test('UI exposes scope, expiry, pending automation and observed-only evidence without embedding secrets', async () => {
  const html = await readFile(new URL('../estado-whatsapp.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../estado-whatsapp.js', import.meta.url), 'utf8');
  assert.match(html, /90 dias/); assert.match(html, /teste completo/); assert.match(html, /Não é uma confirmação recebida da API/);
  assert.match(js, /visibleInMyStatus/); assert.match(js, /doNotRepeat: true/);
  assert.doesNotMatch(html + js, /ADMIN_SESSION_SECRET|tokenHash|localStorage|innerHTML|Bearer/);
});
