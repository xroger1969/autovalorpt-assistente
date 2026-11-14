import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaCatalogHandler } from '../lib/meta-catalog-handler.js';
import stockHandler from '../api/stock.js';

const secret = 'test-cron-value-for-isolated-tests-only-32';
const origin = 'https://autovalorpt-assistente.vercel.app';
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function setup() {
  const calls = []; const logs = [];
  const catalog = Object.fromEntries(['status', 'check', 'run'].map(action => [action, async () => {
    calls.push(action); return { ok: true, status: 'catalog_matches', sourceCount: 9, expectedCount: 9, actualCount: 9, catalogConfirmed: true };
  }]));
  const handle = createMetaCatalogHandler({ env: { CRON_SECRET: secret, INSTAGRAM_STORY_WORKER_SECRET: 'different-story-secret-for-tests-only-32' },
    catalog, authorizeAdmin: req => req.admin === true, log: (...entry) => logs.push(entry) });
  const invoke = async (action, options = {}) => {
    const res = response(); await handle({ method: 'GET', query: { action }, headers: {}, ...options }, res); return res;
  };
  return { invoke, calls, logs, catalog };
}

test('catalogue endpoint stays private and rejects the Story worker credential', async () => {
  const { invoke, calls } = setup();
  assert.equal((await invoke('status')).statusCode, 401);
  assert.equal((await invoke('run', { headers: { authorization: secret } })).statusCode, 401);
  assert.equal((await invoke('run', { headers: { authorization: 'Bearer different-story-secret-for-tests-only-32' } })).statusCode, 401);
  assert.deepEqual(calls, []);
  const res = response();
  await stockHandler({ method: 'GET', query: { integration: 'meta-catalog', action: 'status' }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'private_access_required');
});

test('browser catalogue operations require same-origin POST', async () => {
  const { invoke, calls } = setup();
  assert.equal((await invoke('status', { admin: true })).statusCode, 200);
  assert.equal((await invoke('check', { admin: true })).statusCode, 403);
  assert.equal((await invoke('run', { admin: true, method: 'POST' })).statusCode, 403);
  assert.equal((await invoke('run', { admin: true, method: 'POST', headers: { origin: 'https://example.org', host: new URL(origin).host } })).statusCode, 403);
  assert.equal((await invoke('check', { admin: true, method: 'POST', headers: { origin, host: new URL(origin).host } })).statusCode, 200);
  assert.deepEqual(calls, ['status', 'check']);
});

test('only the existing cron credential allows scheduled runs without a browser', async () => {
  const { invoke, calls, logs } = setup();
  const result = await invoke('run', { headers: { authorization: `Bearer ${secret}` } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(calls, ['run']);
  assert.equal(logs[0][0], 'meta_catalog_result');
  assert.equal(logs[0][1].catalogConfirmed, true);
  assert.equal(logs[0][1].sourceCount, 9);
  assert.match(result.headers['Cache-Control'], /no-store/);
});

test('catalogue failures never leak provider responses or secret values', async () => {
  const { invoke, catalog, logs } = setup();
  catalog.check = async () => { throw Object.assign(new Error(`https://graph.facebook.com/?access_token=${secret}`), { code: 'unsafe ? access_token' }); };
  const result = await invoke('check', { headers: { authorization: `Bearer ${secret}` } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.error, 'catalog_check_failed');
  assert.equal(JSON.stringify([result, logs]).includes(secret), false);
  assert.equal(result.body.inspectStatusBeforeRetry, true);
});
