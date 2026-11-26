import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createWhatsappEditorial } from '../lib/whatsapp-editorial.js';
import { createWhatsappStatusHandler } from '../lib/whatsapp-status-handler.js';
import { editorialPlan } from '../lib/editorial-content.js';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
import { feedEditorialPlan } from '../lib/editorial-simulator.js';
import { memoryBlob } from './helpers/memory-blob.mjs';
import { createEditorialImageHandler } from '../lib/editorial-image-handler.js';
import { whatsappCardContent } from '../lib/whatsapp-editorial-card.js';
import sharp from 'sharp';

const editorial = 'instagram/editorial/v1/production/state.json', history = 'whatsapp-status/v1/production/editorial.json';
const env = { VERCEL_ENV: 'production', INSTAGRAM_USER_ID: '12345678' };
function fixture(plans = [feedEditorialPlan('2026-11-26', true)]) {
  const blob = memoryBlob();
  const state = { version: 1, accountId: env.INSTAGRAM_USER_ID, loginMode: 'instagram', username: 'autovalorpt', items: {}, extraItems: {} };
  for (const post of plans) {
    const { id, title, caption, format, date, version, videoPath } = post;
    (post.extra ? state.extraItems : state.items)[date] = { id, title, caption, format, version, videoPath, status: 'published' };
  }
  const save = () => blob.records.set(editorial, { text: JSON.stringify(state), etag: 'original' });
  save();
  const service = createWhatsappEditorial({ env, storage: blob.storage });
  return { ...blob, state, service, save, id: plans[0].id };
}

test('two read-only snapshots expose only completed, reproducible original daily and extra media and exact saved captions', async () => {
  const v3 = adviceEditorialPlan('2026-11-26', true), v4 = feedEditorialPlan('2026-11-26');
  const reel = editorialPlan('2026-11-22');
  let carousel;
  for (const day of ['21', '23', '24', '25']) {
    const p = editorialPlan('2026-11-' + day);
    if (p.format === 'CAROUSEL') { carousel = p; break; }
  }
  assert.ok(carousel);
  const f = fixture([v3, v4, reel, carousel]);
  f.state.extraItems[v3.date].caption = 'Texto final aprovado.\n\n' + v3.caption;
  f.state.items['2026-11-20'] = { ...f.state.items[v4.date], id: 'wrong-id' };
  f.state.extraItems['2026-11-24'] = { ...f.state.extraItems[v3.date], status: 'unknown' }; f.save();
  const { items } = await f.service.list();
  assert.equal(items.length, 4);
  assert.deepEqual(f.calls.map(x => x.method), ['get', 'get']);
  const old = items.find(x => x.id === v3.id), daily = items.find(x => x.id === v4.id);
  assert.equal(old.caption, f.state.extraItems[v3.date].caption);
  assert.ok(old.shareCaption.includes('Texto final aprovado.'));
  assert.ok(old.shareCaption.split('\n')[1] === 'https://carregador.vercel.app/');
  assert.ok(!old.shareCaption.includes('links do perfil'));
  assert.equal(old.shareCaption.split(old.simulatorUrl).length, 2);
  assert.equal(daily.shareCaption.split(daily.simulatorUrl).length, 2);
  assert.ok(!daily.shareCaption.includes('link do perfil'));
  assert.match(old.media[0].url, /v=v3&extra=1&variant=wa1$/);
  assert.match(daily.media[0].url, /v=v4&variant=wa1$/);
  assert.equal(items.find(x => x.id === reel.id).media[0].url, reel.videoPath);
  assert.equal(items.find(x => x.id === carousel.id).media.length, carousel.slides.length);
  assert.ok(items.every(x => x.status === 'ready' && !x.attemptId));
});

test('the archived 42 km tip shares its complete v3 artwork, explanation and QR as one portrait JPEG', async () => {
  const plan = adviceEditorialPlan('2026-11-26', true);
  const { items: [item] } = await fixture([plan]).service.list();
  const handler = createEditorialImageHandler();
  async function request(query, method = 'GET', headers = {}) {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.code = n; return this; },
      json(data) { this.data = data; }, end(data) { this.data = data; } };
    await handler({ query, headers, method }, res);
    return res;
  }
  const query = Object.fromEntries(new URL(item.media[0].url, 'https://example.test').searchParams);
  const { variant, ...feedQuery } = query;
  assert.equal(variant, 'wa1');
  const original = await request(feedQuery), status = await request(query);
  assert.equal(original.code, 200);
  assert.equal(status.code, 200);
  assert.notEqual(status.headers.ETag, original.headers.ETag);
  assert.match(status.headers['Cache-Control'], /immutable/);
  assert.equal(status.headers['Content-Type'], 'image/jpeg');
  const { format, width, height } = await sharp(status.data).metadata();
  assert.deepEqual([format, width, height], ['jpeg', 1080, 1920]);
  async function meanDifference(a, b) {
    const [first, second] = await Promise.all([a.removeAlpha().raw().toBuffer(), b.removeAlpha().raw().toBuffer()]);
    assert.equal(first.length, second.length);
    let sum = 0;
    for (let i = 0; i < first.length; i++) sum += Math.abs(first[i] - second[i]);
    return sum / first.length;
  }
  assert.ok(await meanDifference(sharp(original.data), sharp(status.data).extract({ left: 0, top: 48, width, height: 1350 })) < 1);
  const content = whatsappCardContent(plan, 0);
  assert.equal(content.url, item.simulatorUrl);
  assert.match(content.summary, /desvios.*quilómetros do mês/);
  assert.match(content.summary, /kWh e por litro/);
  const summary = await sharp(status.data).extract({ left: 72, top: 1434, width: 936, height: 172 }).raw().toBuffer();
  assert.ok(summary.filter(channel => channel > 220).length > 5000);
  const qr = sharp(fileURLToPath(new URL('../assets/editorial/qr-custos.svg', import.meta.url)));
  assert.ok(await meanDifference(qr, sharp(status.data).extract({ left: 823, top: 1600, width: 185, height: 185 })) < 3);
  assert.equal((await request(query, 'HEAD')).headers.ETag, status.headers.ETag);
  assert.equal((await request(query, 'GET', { 'if-none-match': status.headers.ETag })).code, 304);
  assert.equal((await request({ ...query, v: undefined })).code, 400);
  assert.equal((await request({ ...query, variant: 'unknown' })).code, 400);
  assert.equal((await request({ ...query, text: 'free text' })).code, 400);
  assert.equal((await request({ date: '2026-11-22', v: 'v1', variant })).code, 404);
});

test('a legacy entry with just a question or no caption gets the correct description without changing Instagram history', async () => {
  const plan = adviceEditorialPlan('2026-11-26', true);
  const f = fixture([plan]), row = f.state.extraItems[plan.date];
  for (const archived of ['Que desvios fazes no caminho?', plan.title, undefined]) {
    row.caption = archived; f.save();
    const original = f.records.get(editorial).text;
    const { items: [tip] } = await f.service.list();
    assert.equal(tip.caption, archived ?? '');
    if (archived) assert.equal(tip.shareCaption.split(archived).length, 2);
    assert.equal(tip.shareCaption.split(plan.title).length, 2);
    assert.ok(tip.shareCaption.includes(plan.slides[0].body));
    assert.ok(tip.shareCaption.includes(plan.slides[0].takeaway));
    assert.equal(tip.shareCaption.split(tip.simulatorUrl).length, 2);
    assert.equal(f.records.get(editorial).text, original);
  }
  assert.equal(f.calls.some(call => call.method === 'put'), false);
});

test('concurrent tabs, timeouts and retries cannot grant two handoffs; only an explicit checked outcome can resolve one', async () => {
  const f = fixture(), id = f.id, input = [randomUUID(),randomUUID()].map(requestId => ({ id, requestId }));
  const original = f.records.get(editorial).text;
  const results = await Promise.allSettled(input.map(data => f.service.update('tip-claim', data)));
  const granted = results.find(x => x.status === 'fulfilled').value;
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(granted.status, 'unconfirmed');
  const attemptId = granted.attemptId;
  assert.deepEqual(await f.service.update('tip-claim', { id, requestId: attemptId }), granted);
  assert.equal((await f.service.list()).items[0].status, 'unconfirmed');
  await assert.rejects(f.service.update('tip-confirm', { id, attemptId }), /status_tip_input_invalid/);
  await assert.rejects(f.service.update('tip-release', { id, attemptId: randomUUID(), notSent: true }), /status_tip_attempt_changed/);
  const release = { id, attemptId, notSent: true };
  assert.equal((await f.service.update('tip-release', release)).status, 'ready');
  assert.equal((await f.service.update('tip-release', release)).status, 'ready');
  await assert.rejects(f.service.update('tip-claim', { id, requestId: attemptId }), /status_tip_already_claimed/);
  const next = await f.service.update('tip-claim', { id, requestId: randomUUID() });
  const observed = { id, attemptId: next.attemptId, observed: true };
  assert.equal((await f.service.update('tip-confirm', observed)).status, 'confirmed');
  assert.equal((await f.service.update('tip-confirm', observed)).status, 'confirmed');
  assert.equal((await f.service.list()).items[0].status, 'confirmed');
  await assert.rejects(f.service.update('tip-claim', { id, requestId: randomUUID() }), /status_tip_already_claimed/);
  assert.equal(JSON.parse(f.records.get(history).text).items[id].length, 2);
  assert.ok(f.calls.filter(x => x.method === 'put').every(x => x.path === history));
  assert.equal(f.records.get(editorial).text, original);
});

test('unpublished or unknown editions, unexpected Reel asset, account changes, and untrusted requests fail closed', async () => {
  const invalid = fixture([editorialPlan('2026-11-22')]);
  invalid.state.items['2026-11-22'].videoPath = 'https://example.com/other.mp4'; invalid.save();
  assert.equal((await invalid.service.list()).items.length, 0);
  await assert.rejects(invalid.service.update('tip-claim', { id: invalid.id, requestId: randomUUID() }), /status_tip_not_available/);
  invalid.state.accountId = '0000000'; invalid.save();
  await assert.rejects(invalid.service.list(), /status_binding_changed/);
  assert.equal(invalid.calls.filter(x => x.method === 'put').length, 0);
  const service = createWhatsappStatusHandler({ env, authorizeAdmin: req => req.admin, tips: invalid.service });
  async function expect(action, method, admin, headers, code) {
    const res = { setHeader() {}, status(n) { this.code = n; return this; }, json() {} };
    await service({ method, query: { action }, admin, headers }, res);
    assert.equal(res.code, code);
  }
  await expect('tip-list', 'GET', false, { cookie: '__Host-avpt_wa_status=' + 'a'.repeat(43) }, 401);
  await expect('tip-claim', 'GET', true, {}, 405);
  await expect('tip-release', 'POST', true, { origin: 'https://other.test', host: 'example.test' }, 403);
});
