import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockSelectionHandler } from '../lib/stock-selection-handler.js';
import stockRoute from '../api/stock.js';

const origin = 'https://autovalorpt-assistente.vercel.app';
const decision = { revision: 'a'.repeat(64), mode: 'choose', selectedIds: ['ID8ABCDE'] };
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('the catalogue choice is private, read-only on GET and only runs Meta after a committed decision', async () => {
  const calls = [];
  const review = { revision: decision.revision, pending: [], defaultIds: [] };
  const source = { review: async () => { calls.push('review'); return review; },
    decide: async body => { calls.push(body); return { valid: true, expectedCount: 3 }; } };
  const catalog = { run: async () => { calls.push('meta'); return { status: 'import_requested' }; } };
  const handle = createStockSelectionHandler({ authorizeAdmin: req => req.admin, source, catalog });
  const invoke = async (settings = {}) => {
    const res = response();
    await handle({ headers: {}, method: 'GET', admin: true, ...settings }, res);
    return res;
  };
  const post = { method: 'POST', headers: { origin, host: new URL(origin).host }, body: decision };
  const anon = response();
  await stockRoute({ method: 'GET', query: { integration: 'stock-selection' }, headers: {} }, anon);
  assert.equal(anon.code, 401);
  assert.equal((await invoke({ admin: false })).code, 401);
  assert.equal((await invoke({ ...post, headers: {} })).code, 403);
  assert.equal((await invoke({ ...post, headers: { origin: 'https://elsewhere.invalid', host: new URL(origin).host } })).code, 403);
  assert.equal((await invoke({ ...post, body: { mode: 'all' } })).code, 400);
  assert.deepEqual(calls, []);
  const displayed = await invoke();
  assert.deepEqual(displayed.body, { ok: true, review });
  assert.match(displayed.headers['Cache-Control'], /no-store/);
  const result = await invoke(post);
  assert.deepEqual(result.body, { ok: true, total: 3, whatsapp: { status: 'import_requested' } });
  assert.deepEqual(calls, ['review', decision, 'meta']);
  source.decide = async () => ({ valid: false, reason: 'stock_selection_stale' });
  assert.equal((await invoke(post)).code, 409);
  assert.equal(calls.filter(x => x === 'meta').length, 1);
  source.decide = async () => ({ valid: true, expectedCount: 3 });
  catalog.run = async () => { throw Error('offline'); };
  const retry = await invoke(post);
  assert.deepEqual(retry.body, { ok: true, total: 3, whatsapp: { status: 'check_failed' } });
});
