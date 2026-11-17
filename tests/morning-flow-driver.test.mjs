import test from 'node:test';
import assert from 'node:assert/strict';
import { createMorningFlow } from '../lib/morning-flow.js';
import { createMorningFlowHandler } from '../lib/morning-flow-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const origin = 'https://autovalorpt-assistente.vercel.app';
const secret = 'synthetic-cron-with-more-than-32-characters';
const day = '2026-11-17';
const path = `morning-flow/v1/production/manual-${day}.json`;
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function fixture(settings = {}) {
  const memory = memoryBlob(), operations = [], pending = [], budgets = [], waits = [], errors = [];
  let elapsed = 0; const baseline = Date.parse(`${day}T18:00:00Z`);
  const env = { VERCEL_ENV: 'production', CRON_SECRET: secret };
  const services = {
    source: { audit: async () => ({ valid: true }), sync: async () => { operations.push('source'); elapsed += settings.sourceCost || 0; return { valid: true, sourceCount: 9, expectedCount: 9 }; } },
    catalog: { status: async () => ({}), run: async () => { operations.push('catalog'); return { ok: true, status: 'catalog_matches' }; }, check: async () => ({ ok: true }) },
    retirements: { run: async () => { operations.push('retirements'); return { ok: true, status: 'no_retirements' }; }, status: async () => ({}) },
    photo: { run: async () => { operations.push('photo'); return { ok: true, status: 'published', published: 1, id: 'ID8new001' }; }, status: async () => ({}) },
    story: { run: async () => { operations.push('story'); return { ok: true, status: 'published', published: 1, id: 'ID8new001' }; }, status: async () => ({}) },
  };
  const options = { env, storage: memory.storage, now: () => baseline + elapsed, runtimeNow: () => elapsed,
    localDriver: true, fetchImpl: async () => { throw new Error('self HTTP must not be called'); },
    pause: async ms => { waits.push(ms); elapsed += ms; }, services,
    createServices: async ({ runBudgetMs }) => { budgets.push(runBudgetMs); return services; },
    waitUntil: promise => pending.push(promise), authorizeAdmin: req => req.admin === true,
    report: entry => errors.push(entry), driverBudgetMs: settings.budgetMs || 260000 };
  const handler = createMorningFlowHandler(options);
  const invoke = async (action, extra = {}) => {
    const res = response();
    await handler({ method: 'POST', admin: true, headers: { host: new URL(origin).host, origin }, query: { action, mode: 'manual' }, ...extra }, res);
    await Promise.all(pending.splice(0)); return res;
  };
  const flow = createMorningFlow({ ...options, mode: 'manual' });
  return { memory, operations, services, options, flow, invoke, waits, budgets, errors, advance: ms => { elapsed += ms; } };
}

test('local driver drains all six durable stages without self-HTTP and keeps ticket private', async () => {
  const f = fixture(); const result = await f.invoke('manual-start');
  assert.equal(result.statusCode, 202); assert.equal(result.body.delivery, undefined);
  assert.deepEqual(f.operations, ['source', 'catalog', 'retirements', 'photo', 'story']);
  const state = await f.flow.status(); assert.equal(state.status, 'finished'); assert.equal(state.step, 'verify');
  assert.equal(state.ticket, undefined); assert.equal(f.errors.filter(entry => entry.reason).length, 0);
  assert.ok(f.budgets.every(value => value <= 245000));
  await f.invoke('manual-start'); await f.invoke('resume');
  assert.equal(f.operations.filter(value => value === 'photo').length, 1);
});

test('budget stop leaves a queued claim untouched and authenticated resume completes it once', async () => {
  const f = fixture({ budgetMs: 80000, sourceCost: 25000 });
  await f.invoke('manual-start');
  const stopped = await f.flow.status(); assert.equal(stopped.status, 'queued'); assert.equal(stopped.step, 'catalog');
  assert.deepEqual(f.operations, ['source']);
  assert.ok(f.errors.some(entry => entry.reason === 'invocation_budget_exhausted'));
  const resumed = await f.invoke('resume'); assert.equal(resumed.statusCode, 202);
  assert.equal((await f.flow.status()).status, 'finished');
  assert.deepEqual(f.operations, ['source', 'catalog', 'retirements', 'photo', 'story']);
});

test('processing delay survives budget exit and resume uses the same saved photo container', async () => {
  const f = fixture({ budgetMs: 95000, sourceCost: 20000 }); let calls = 0;
  f.services.photo.run = async () => ({ id: 'ID8new001', status: ++calls === 1 ? 'preparing' : 'published', published: calls === 1 ? 0 : 1 });
  f.services.photo.status = async () => ({ active: calls === 1 ? { id: 'ID8new001', phase: 'preparing' } : null });
  await f.invoke('manual-start');
  assert.equal((await f.flow.status()).step, 'photo'); assert.equal(calls, 1); assert.deepEqual(f.waits, []);
  await f.invoke('resume');
  assert.equal(calls, 2); assert.deepEqual(f.waits, [30000]);
  assert.equal((await f.flow.status()).status, 'finished');
});

test('resume bootstraps a pre-migration snapshot before claiming queued Story work', async () => {
  const f = fixture(); await f.flow.start();
  const persisted = f.memory.records.get(path); const state = JSON.parse(persisted.text); state.step = 'story';
  f.memory.records.set(path, { ...persisted, text: JSON.stringify(state) });
  f.services.source.audit = async () => { f.operations.push('audit'); return { valid: false, reason: 'stock_not_synchronized' }; };
  f.services.source.sync = async () => { f.operations.push('bootstrap'); return { valid: true }; };
  await f.invoke('resume');
  assert.deepEqual(f.operations, ['audit', 'bootstrap', 'story']);
  assert.equal((await f.flow.status()).status, 'finished');
});

test('failed snapshot bootstrap leaves queued work unclaimed and never publishes', async () => {
  const f = fixture(); await f.flow.start();
  const persisted = f.memory.records.get(path); const state = JSON.parse(persisted.text); state.step = 'photo';
  f.memory.records.set(path, { ...persisted, text: JSON.stringify(state) });
  f.services.source.audit = async () => ({ valid: false, reason: 'stock_not_synchronized' });
  f.services.source.sync = async () => ({ valid: false, reason: 'source_incomplete_inventory' });
  await f.invoke('resume');
  assert.equal((await f.flow.status()).status, 'queued'); assert.deepEqual(f.operations, []);
  assert.equal(f.errors[0].reason, 'source_incomplete_inventory');
});

test('resume requires POST and either same-origin admin or existing cron credential', async () => {
  const f = fixture();
  assert.equal((await f.invoke('resume', { admin: false, headers: {} })).statusCode, 401);
  assert.equal((await f.invoke('resume', { method: 'GET' })).statusCode, 403);
  assert.equal((await f.invoke('resume', { headers: {} })).statusCode, 403);
  assert.equal((await f.invoke('resume', { headers: { host: new URL(origin).host, origin: 'https://evil.example' } })).statusCode, 403);
  const result = await f.invoke('resume', { admin: false, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.status, 'not_started');
  assert.equal((await f.flow.status()).status, 'not_started');
});
