import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramEditorial } from '../lib/instagram-editorial.js';
import { createInstagramEditorialHandler } from '../lib/instagram-editorial-handler.js';
import { editorialPlan } from '../lib/editorial-content.js';
import { scheduledEditorialPlan } from '../lib/electric-editorial-calendar.js';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const env = { VERCEL_ENV: 'production', INSTAGRAM_EDITORIAL_ENABLED: 'true', INSTAGRAM_USER_ID: '12345678',
  INSTAGRAM_ACCESS_TOKEN: 'mock', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app' };
const path = 'instagram/editorial/v1/production/state.json';
function fixture({ time = '2026-11-25T20:30:00Z', state, config = {} } = {}) {
  const m = memoryBlob();
  const originalHead = m.storage.head;
  let heads = 0;
  m.storage.head = (...args) => { heads++; return originalHead(...args); };
  if (state) m.records.set(path, { text: JSON.stringify({ version: 1, accountId: env.INSTAGRAM_USER_ID, username: 'autovalorpt',
    loginMode: 'instagram', items: {}, ...state }), etag: 'v1' });
  const unexpected = () => { throw new Error('a read-only calendar must not prepare, access a live source, or publish'); };
  const publisher = createInstagramEditorial({ env: { ...env, ...config }, storage: m.storage, now: () => Date.parse(time),
    tokenManager: { status: unexpected, resolve: unexpected }, fetchImpl: unexpected, prepareElectricEdition: unexpected });
  return { publisher, memory: m, heads: () => heads };
}

test('one private read returns seven real Lisbon plans and all authored visuals, without drafts, AI or Meta', async () => {
  const f = fixture();
  const result = await f.publisher.calendar();
  assert.equal(result.timezone, 'Europe/Lisbon');
  assert.equal(result.time, '19:00');
  assert.equal(result.enabled, true);
  assert.equal(result.blocked, false);
  assert.deepEqual(result.items.map(x => x.date), ['2026-11-26','2026-11-27','2026-11-28','2026-11-29','2026-11-30','2026-12-01','2026-12-02']);
  for (const slot of result.items) {
    const plan = adviceEditorialPlan(slot.date);
    assert.equal(slot.scheduledAt, slot.date + 'T19:00:00.000Z');
    assert.equal(slot.status, 'scheduled');
    assert.equal(slot.provisional, true);
    assert.equal(slot.caption, plan.caption);
    assert.equal(slot.title, plan.title);
    assert.equal(slot.format, plan.format);
    assert.deepEqual(slot.altTexts, plan.slides.map(slide => slide.altText));
    assert.equal(slot.images.length, plan.slides.length);
    slot.images.forEach((url, index) => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('date'), plan.date);
      assert.equal(params.get('v'), plan.version);
      assert.equal(params.get('slide'), String(index + 1));
    });
    if (plan.videoPath) assert.equal(slot.videoUrl, env.INSTAGRAM_PUBLIC_BASE_URL + plan.videoPath);
  }
  assert.equal(result.items[3].format, 'REELS');
  assert.deepEqual(f.memory.calls.map(call => [call.method, call.path]), [['get', path]]);
  assert.equal(f.heads(), 0);
});

test('an actual completed slot moves the first date forward, and Lisbon 19:00 adjusts for daylight saving', async () => {
  const f = fixture({ time: '2027-03-26T11:00:00Z', state: { items: { '2027-03-26': { status: 'published' } } } });
  const { items } = await f.publisher.calendar();
  assert.equal(items[0].date, '2027-03-27');
  assert.equal(items[0].scheduledAt, '2027-03-27T19:00:00.000Z');
  assert.equal(items[1].scheduledAt, '2027-03-28T18:00:00.000Z');
  assert.ok(items.every(slot => slot.images.length && slot.images.length === slot.altTexts.length));
});

test('separates a paused agenda, unavailable deployment and unconfirmed sends; never mistakes extra content for a daily item', async () => {
  const stopped = fixture({ state: { enabled: false } });
  assert.ok((await stopped.publisher.calendar()).items.every(item => item.status === 'paused'));
  const unconfigured = fixture({ config: { INSTAGRAM_ACCESS_TOKEN: '' } });
  assert.ok((await unconfigured.publisher.calendar()).items.every(item => item.status === 'unavailable'));
  const unsettled = fixture({ state: { active: { id: 'extra-old', date: '2026-11-25', extra: true, phase: 'unknown', caption: 'Outro texto' } } });
  const pending = await unsettled.publisher.calendar();
  assert.equal(pending.blocked, true);
  assert.ok(pending.items.every(item => item.status === 'review_required' && item.provisional && item.caption !== 'Outro texto'));
  const activeDate = '2026-11-26';
  const plan = adviceEditorialPlan(activeDate);
  const f = fixture({ time: activeDate + 'T19:15:00Z', state: { active: {
    id: plan.id, date: activeDate, phase: 'preparing', caption: 'Legenda exata da tentativa já preparada.',
    sources: [{ label: 'Fonte', url: 'https://example.org' }],
  } } });
  const running = (await f.publisher.calendar()).items;
  assert.equal(running[0].status, 'preparing');
  assert.equal(running[0].caption, 'Legenda exata da tentativa já preparada.');
  assert.equal(running[0].provisional, false);
  assert.equal(running[0].sources.length, 1);
  assert.ok(running.slice(1).every(item => item.provisional));
  assert.equal(f.heads(), 0);
  assert.equal(f.memory.calls.length, 1);
});

test('a claimed pre-deployment v1 post retains its title and original dated slide URLs', async () => {
  const date = '2026-11-26', old = editorialPlan(date);
  assert.notEqual(old.id, scheduledEditorialPlan(date).id);
  const f = fixture({ time: date + 'T19:05:00Z', state: { active: { date, id: old.id, title: old.title, phase: 'creating', caption: old.caption } } });
  const slot = (await f.publisher.calendar()).items[0];
  assert.equal(slot.id, old.id);
  assert.equal(slot.title, old.title);
  assert.equal(slot.caption, old.caption);
  assert.equal(slot.provisional, false);
  assert.ok(slot.images.every(image => new URL(image).searchParams.get('v') === 'v1'));
});

test('a claimed v2 post keeps its original electric artwork after v3 is deployed', async () => {
  const date = '2026-11-26', old = scheduledEditorialPlan(date);
  const f = fixture({ time: date + 'T19:05:00Z', state: { active: { date, id: old.id, title: old.title, phase: 'creating', caption: old.caption } } });
  const slot = (await f.publisher.calendar()).items[0];
  assert.equal(slot.caption, old.caption);
  assert.equal(slot.provisional, false);
  assert.equal(slot.id, old.id);
  assert.ok(slot.images.every(image => new URL(image).searchParams.get('v') === 'v2'));
});

test('calendar handler enforces private GET and never accepts a caller-supplied date or triggers a write action', async () => {
  let calls = 0;
  const handle = createInstagramEditorialHandler({ env, authorizeAdmin: req => req.admin === true,
    publisher: { calendar(...args) { calls++; assert.equal(args.length, 0); return { ok: true, items: [] }; } } });
  for (const [method, admin, status] of [['GET', false, 401], ['POST', true, 405], ['GET', true, 200]]) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handle({ headers: {}, method, admin, query: { action: 'calendar', date: '2100-01-01' } }, res);
    assert.equal(res.code, status);
  }
  assert.equal(calls, 1);
});
