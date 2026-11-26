import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMorningFlow, lisbonClock, MORNING_STEPS } from '../lib/morning-flow.js';
import { createMorningFlowHandler } from '../lib/morning-flow-handler.js';
import stockHandler from '../api/stock.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const secret = 'synthetic-test-only-cron-secret-000000';
const origin = 'https://autovalorpt-assistente.vercel.app';
const id = 'ID8new001';
function fixture() {
  let time = Date.parse('2026-11-15T08:00:00Z');
  const memory = memoryBlob(); const queue = []; const calls = []; const logs = [];
  const env = { VERCEL_ENV: 'production', CRON_SECRET: secret };
  const services = {
    source: { audit: async () => { calls.push('source'); return { valid: true, sourceCount: 9, expectedCount: 9 }; } },
    catalog: { status: async () => ({ lastResult: { sourceValid: true, expectedCount: 9 } }),
      run: async () => { calls.push('catalog'); return { ok: false, status: 'authorization_required', catalogConfirmed: false }; },
      check: async () => { calls.push('verify'); return { status: 'authorization_required', catalogConfirmed: false }; } },
    retirements: { run: async () => { calls.push('retirements'); return { ok: true, status: 'no_retirements', retired: 0, remaining: 0 }; }, status: async () => ({ ok: true }) },
    photo: { run: async () => { calls.push('photo'); return { ok: true, status: 'published', published: 1, id }; }, status: async () => ({ ok: true }) },
    story: { run: async () => { calls.push('story'); return { ok: true, status: 'published', published: 1, id }; }, status: async () => ({ ok: true }) }
  };
  const options = { env, services, storage: memory.storage, now: () => time, pause: async ms => { time += ms; },
    report: entry => logs.push(entry), fetchImpl: async (url, opts) => {
      queue.push({ url, opts, ...Object.fromEntries(new URL(url).searchParams) }); return new Response('{}', { status: 202 });
    } };
  const flow = createMorningFlow(options);
  async function start() { const result = await flow.start(); if (result.delivery) await flow.deliver(result.delivery.day, result.delivery.ticket); return result; }
  async function tick() {
    const message = queue.shift(); if (!message) return;
    if (message.action === 'delay') return flow.delay(message.day, message.ticket);
    const record = await flow.claim(message.day, message.ticket); if (record) await flow.execute(record);
  }
  async function drain() { for (let i = 0; queue.length && i < 100; i++) await tick(); assert.equal(queue.length, 0); }
  return { flow, start, tick, drain, queue, calls, logs, memory, services, env, options,
    setTime: value => { time = Date.parse(value); }, advance: ms => { time += ms; } };
}

test('Lisbon local 08:00 survives winter, summer and both DST transition days', () => {
  for (const date of ['2026-11-15T08:00:00Z', '2026-07-01T07:00:00Z', '2027-03-28T07:00:00Z', '2026-10-25T08:00:00Z']) assert.equal(lisbonClock(date).hour, 8);
  assert.equal(lisbonClock('2026-07-01T08:00:00Z').hour, 9);
  assert.equal(lisbonClock('2026-11-15T07:00:00Z').hour, 7);
});

test('source, catalog, retirements, photo, Story and verification execute in order despite catalog authorization blocker', async () => {
  const f = fixture(); await f.start(); await f.drain();
  assert.deepEqual(f.calls, MORNING_STEPS);
  const state = await f.flow.status();
  assert.equal(state.status, 'finished'); assert.equal(state.results.catalog.status, 'authorization_required');
  assert.equal(state.results.verify.catalogConfirmed, false); assert.equal(state.whatsappVisibilityVerified, false);
  assert.equal(state.whatsappStatus, 'manual_pending'); assert.equal(state.ticket, undefined);
});

test('concurrent starts and duplicate deliveries cannot publish a second car on the same day', async () => {
  const f = fixture(); await Promise.all([f.start(), f.start(), f.start()]);
  const message = f.queue[0];
  const claims = await Promise.all([f.flow.claim(message.day, message.ticket), f.flow.claim(message.day, message.ticket)]);
  assert.equal(claims.filter(Boolean).length, 1); await f.flow.execute(claims.find(Boolean));
  await f.drain(); await f.start(); await f.drain();
  assert.equal(f.calls.filter(c => c === 'photo').length, 1); assert.equal(f.calls.filter(c => c === 'story').length, 1);
});

test('an incomplete source blocks every mutation, then continues when the updated Sheet matches', async () => {
  const f = fixture(); let ready = false; let previous;
  f.services.source.audit = async input => { previous = input.previousExpectedCount; return { valid: ready, reason: ready ? undefined : 'feed_mismatch', expectedCount: 9 }; };
  await f.start(); await f.tick(); assert.deepEqual(f.calls, []);
  assert.equal((await f.flow.status()).step, 'source'); assert.equal(previous, 9);
  ready = true; await f.drain(); assert.equal(f.calls[0], 'catalog');
});

test('persistent source mismatch stops after bounded read-only retries without retirements or posts', async () => {
  const f = fixture(); f.services.source.audit = async () => ({ valid: false, reason: 'feed_mismatch' });
  await f.start(); await f.drain();
  assert.equal((await f.flow.status()).status, 'blocked'); assert.equal((await f.flow.status()).attempts.source, 30);
  assert.deepEqual(f.calls, []);
});

test('preparing photo resumes only its saved container and never selects another item', async () => {
  const f = fixture(); let runs = 0;
  f.services.photo.run = async () => ({ ok: true, status: ++runs === 1 ? 'preparing' : 'published', published: runs === 1 ? 0 : 1, id });
  f.services.photo.status = async () => ({ active: runs === 1 ? { id, phase: 'preparing' } : null });
  await f.start(); await f.drain(); await f.start(); await f.drain();
  assert.equal(runs, 2); assert.equal((await f.flow.status()).results.photo.published, 1);
});

test('carousel children resume through the morning flow before a parent container exists', async () => {
  const f = fixture(); let runs = 0;
  f.services.photo.run = async () => ({ ok: true, status: ++runs === 1 ? 'preparing' : 'published',
    id, published: runs === 1 ? 0 : 1, mediaType: 'CAROUSEL', imageCount: 20 });
  f.services.photo.status = async () => ({ active: runs === 1
    ? { id, phase: 'preparing_children', mediaType: 'CAROUSEL', preparedImages: 7, imageCount: 20, containerId: null }
    : null });
  await f.start(); await f.drain(); await f.start(); await f.drain();
  const state = await f.flow.status();
  assert.equal(runs, 2);
  assert.equal(state.attempts.photo, 2);
  assert.equal(state.results.photo.status, 'published');
  assert.equal(state.results.photo.published, 1);
});

test('private carousel leases can return busy until the same photo publisher resumes safely', async () => {
  for (const phase of ['creating_children', 'creating_carousel']) {
    const f = fixture(); let runs = 0;
    f.services.photo.run = async () => ({ ok: true, id,
      status: ++runs === 1 ? 'preparing' : runs < 4 ? 'busy' : 'published', published: runs === 4 ? 1 : 0 });
    f.services.photo.status = async () => ({ active: runs < 4 ? { id, phase, mediaType: 'CAROUSEL' } : null });
    await f.start(); await f.drain();
    assert.equal(runs, 4, phase);
    assert.equal((await f.flow.status()).results.photo.published, 1);
    assert.equal(f.options.now(), Date.parse('2026-11-15T08:01:30Z'));
  }
});

test('carousel resume permission never includes uncertain publications, Stories or another vehicle', async () => {
  const cases = [
    ['photo', { id, phase: 'publishing', mediaType: 'CAROUSEL' }],
    ['photo', { id, phase: 'unknown', mediaType: 'CAROUSEL' }],
    ['photo', { id, phase: 'creating', mediaType: 'CAROUSEL' }],
    ['photo', { id, phase: 'preparing_children', mediaType: 'IMAGE' }],
    ['photo', { id: 'ID8other1', phase: 'preparing_children', mediaType: 'CAROUSEL' }],
    ['story', { id, phase: 'preparing_children', mediaType: 'CAROUSEL' }],
    ['story', { id, phase: 'creating_children', mediaType: 'CAROUSEL' }],
    ['story', { id, phase: 'creating_carousel', mediaType: 'CAROUSEL' }],
    ['photo', null],
  ];
  for (const [step, active] of cases) {
    const f = fixture(); let runs = 0;
    f.services[step].run = async () => { runs++; return { ok: true, status: 'preparing', id, published: 0 }; };
    f.services[step].status = async () => ({ active });
    await f.start(); await f.drain();
    assert.equal(runs, 1, `${step}: ${active?.phase ?? 'missing'}`);
    assert.equal((await f.flow.status()).results[step].reason, 'resume_state_changed');
  }
});

test('carousel preparation cannot cause an unbounded morning-flow retry loop', async () => {
  const f = fixture(); let runs = 0;
  f.services.photo.run = async () => { runs++; return { ok: true, status: 'preparing', id, published: 0 }; };
  f.services.photo.status = async () => ({ active: { id, phase: 'preparing_children', mediaType: 'CAROUSEL' } });
  await f.start(); await f.drain();
  assert.equal(runs, 20);
  assert.equal((await f.flow.status()).attempts.photo, 20);
  assert.equal((await f.flow.status()).results.photo.published, 0);
});

test('changed resume identity stops publication and retains a review marker', async () => {
  const f = fixture(); let runs = 0;
  f.services.photo.run = async () => { runs++; return { status: 'preparing', id }; };
  f.services.photo.status = async () => ({ active: { id: 'ID8other1', phase: 'preparing' } });
  await f.start(); await f.drain(); assert.equal(runs, 1);
  assert.equal((await f.flow.status()).results.photo.reason, 'resume_state_changed');
});

test('Story busy continuation waits in separate invocations and is limited to the same preparing container', async () => {
  const f = fixture(); let runs = 0;
  f.services.story.run = async () => ({ id, status: ++runs === 1 ? 'preparing' : runs < 4 ? 'busy' : 'published', published: runs === 4 ? 1 : 0 });
  f.services.story.status = async () => ({ active: runs < 4 ? { id, phase: 'preparing' } : null });
  await f.start(); await f.drain(); assert.equal(runs, 4);
  assert.equal((await f.flow.status()).results.story.published, 1);
});

test('mapping pending or unknown publication is never retried as a new Story', async () => {
  for (const status of ['mapping_pending', 'review_required', 'publish_unknown', 'busy']) {
    const f = fixture(); let runs = 0;
    f.services.story.run = async () => { runs++; return { status, id }; };
    await f.start(); await f.drain(); await f.start(); assert.equal(runs, 1);
  }
});

test('retirements finish multiple safe batches before the photo and retain their total', async () => {
  const f = fixture(); let runs = 0;
  f.services.retirements.run = async () => { f.calls.push('retirements'); runs++; return { status: 'retired', retired: 2, remaining: runs < 3 ? 2 : 0 }; };
  await f.start(); await f.drain(); assert.equal(runs, 3);
  assert.equal((await f.flow.status()).results.retirements.retired, 6);
  assert.deepEqual(f.calls, ['source', 'catalog', 'retirements', 'retirements', 'retirements', 'photo', 'story', 'verify']);
});

test('a failed completion write leaves the running claim intact and never repeats a mutation', async () => {
  const f = fixture(); await f.start(); await f.tick(); await f.tick(); await f.tick();
  f.memory.faults.put = (_, state) => state.results.photo;
  await assert.rejects(f.tick()); f.memory.faults.put = null;
  await f.start(); await f.drain(); assert.equal(f.calls.filter(c => c === 'photo').length, 1);
  f.advance(361000); assert.equal((await f.flow.status()).requiresReview, true);
});

test('callback transport retries are pinned to production, reject redirects and never expose credentials in logs', async () => {
  const f = fixture(); let requests = 0; const urls = [];
  const flow = createMorningFlow({ ...f.options, fetchImpl: async (url, options) => {
    requests++; urls.push(url); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    throw new Error(`provider leaked ${secret}`);
  } });
  const result = await flow.start(); await flow.deliver(result.delivery.day, result.delivery.ticket);
  assert.equal(requests, 3); assert.ok(urls.every(url => new URL(url).origin === origin));
  assert.equal(JSON.stringify(f.logs).includes(secret), false); assert.equal((await flow.status()).status, 'queued');
});

test('preview and the inactive seasonal cron cannot start production work; old-day callbacks are rejected', async () => {
  const f = fixture(); f.env.VERCEL_ENV = 'preview'; assert.equal((await f.start()).status, 'production_only');
  f.env.VERCEL_ENV = 'production'; f.setTime('2026-11-15T07:00:00Z'); assert.equal((await f.start()).status, 'outside_window');
  f.setTime('2026-11-15T08:00:00Z'); await f.start(); const message = f.queue[0];
  f.setTime('2026-11-16T08:00:00Z'); assert.equal(await f.flow.claim(message.day, message.ticket), null);
});

test('cycle cannot continue mutating beyond its one-hour limit', async () => {
  const f = fixture(); await f.start(); f.advance(3600001); await f.tick();
  assert.equal((await f.flow.status()).status, 'interrupted'); assert.deepEqual(f.calls, []);
});

function response() { return { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }

test('recent scheduled history looks back seven Lisbon calendar days and returns only the latest prior run', async () => {
  const f = fixture();
  const manualFlow = createMorningFlow({ ...f.options, mode: 'manual' });
  f.setTime('2026-06-24T07:00:00Z');
  await f.flow.start();
  f.setTime('2026-07-01T23:30:00Z');
  assert.deepEqual(await f.flow.latestPrior(), { ok: true, day: '2026-07-02', latest: null });

  f.setTime('2026-06-25T07:00:00Z');
  await f.flow.start();
  f.setTime('2026-07-01T07:00:00Z');
  await manualFlow.start();
  f.setTime('2026-07-02T07:00:00Z');
  await f.flow.start();
  f.setTime('2026-07-01T23:30:00Z');
  const before = f.memory.calls.length;
  assert.deepEqual(await f.flow.latestPrior(), {
    ok: true, day: '2026-07-02', latest: { day: '2026-06-25', startedAt: '2026-06-25T07:00:00.000Z' }
  });
  assert.deepEqual(f.memory.calls.slice(before).map(({ method, path }) => [method, path.slice(-15)]),
    ['2026-07-01', '2026-06-30', '2026-06-29', '2026-06-28', '2026-06-27', '2026-06-26', '2026-06-25']
      .map(day => ['get', day + '.json']));

  f.setTime('2026-07-01T07:00:00Z');
  await f.flow.start();
  f.setTime('2026-07-01T23:30:00Z');
  const start = f.memory.calls.length;
  assert.equal((await f.flow.latestPrior()).latest.day, '2026-07-01');
  assert.equal(f.memory.calls.length - start, 1);
});

test('recent history is a private GET and a missing newer read cannot yield an empty or older result', async () => {
  const f = fixture();
  f.setTime('2026-11-13T08:00:00Z');
  await f.flow.start();
  f.setTime('2026-11-16T08:00:00Z');
  const handler = createMorningFlowHandler({ ...f.options, authorizeAdmin: req => req.admin === true,
    waitUntil: () => assert.fail('History must never schedule work') });
  const invoke = async ({ query, ...options } = {}) => {
    const res = response();
    await handler({ admin: true, method: 'GET', headers: {}, ...options,
      query: { action: 'latest-prior', ...query } }, res);
    return res;
  };
  assert.equal((await invoke({ admin: false })).statusCode, 401);
  assert.equal((await invoke({ admin: false, headers: { authorization: `Bearer ${secret}` } })).statusCode, 401);
  assert.equal((await invoke({ method: 'POST' })).statusCode, 405);
  assert.equal((await invoke({ query: { mode: 'manual' } })).statusCode, 400);
  f.memory.faults.get = path => path.endsWith('/2026-11-14.json');
  const failed = await invoke();
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.body.error, 'morning_flow_unavailable');
  assert.equal(Object.hasOwn(failed.body, 'latest'), false);
  f.memory.faults.get = path => path.endsWith('/2026-11-12.json');
  const found = await invoke({ query: { day: '2000-01-01' } });
  assert.equal(found.statusCode, 200);
  assert.match(found.headers['Cache-Control'], /no-store/);
  assert.deepEqual(found.body, { ok: true, day: '2026-11-16', latest: { day: '2026-11-13', startedAt: '2026-11-13T08:00:00.000Z' } });
  f.env.VERCEL_ENV = 'preview';
  const before = f.memory.calls.length;
  const preview = await invoke();
  assert.equal(preview.body.status, 'production_only');
  assert.equal(f.memory.calls.length, before);
  assert.equal(f.queue.length, 0);
});

test('endpoint keeps status private, requires same-origin admin start and restricts callbacks to the cron secret', async () => {
  const f = fixture(); const pending = [];
  const handler = createMorningFlowHandler({ ...f.options, authorizeAdmin: req => req.admin === true, waitUntil: p => pending.push(p) });
  const invoke = async (action, extra = {}) => { const res = response(); await handler({ query: { action }, method: 'GET', headers: {}, ...extra }, res); return res; };
  assert.equal((await invoke('status')).statusCode, 401);
  assert.equal((await invoke('status', { admin: true })).statusCode, 200);
  assert.equal((await invoke('start', { admin: true })).statusCode, 403);
  assert.equal((await invoke('continue', { admin: true, method: 'POST' })).statusCode, 403);
  assert.equal((await invoke('start', { admin: true, method: 'POST', headers: { origin: 'https://evil.example', host: new URL(origin).host } })).statusCode, 403);
  const result = await invoke('start', { headers: { authorization: `Bearer ${secret}`, host: 'evil.example' } });
  assert.equal(result.statusCode, 202); await Promise.all(pending); assert.equal(f.queue.length, 1);
  assert.equal(new URL(f.queue[0].url).origin, origin); assert.equal(result.body.delivery, undefined);
  const res = response(); await stockHandler({ query: { integration: 'morning-flow', action: 'start' }, method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('new scheduler replaces all independent social crons and preserves unrelated lead retry', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons.filter(c => c.path.includes('morning-flow')).map(c => c.schedule), ['0 7 * * *', '0 8 * * *']);
  assert.equal(config.crons.some(c => /instagram-sync|meta-catalog/.test(c.path)), false);
  assert.ok(config.crons.some(c => c.path === '/api/notify-lead?action=retry-pending' && c.schedule === '0 8 * * *'));
  assert.equal(config.functions['api/stock.js'].maxDuration, 300);
});

test('intentional Instagram retention is successful while catalogue and posting remain independent', async () => {
  const f=fixture();
  f.services.retirements.run=async()=>({ok:true,status:'disabled',retired:0});
  f.services.retirements.status=async()=>({ok:true,configuration:{enabled:false},lastResult:{status:'retired',retired:4}});
  await f.start(); await f.drain();
  const state=await f.flow.status();
  assert.equal(state.results.retirements.status,'preserved');
  assert.equal(state.verification.retirements.status,'preserved');
  assert.equal(state.results.retirements.retired,0);
  assert.equal(state.results.photo.status,'published'); assert.equal(state.results.story.status,'published');
  assert.ok(f.calls.includes('catalog'));
});
