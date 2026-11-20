import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramEditorialHandler } from '../lib/instagram-editorial-handler.js';
import { createEditorialImageHandler } from '../lib/editorial-image-handler.js';
import stockHandler from '../api/stock.js';

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(v) { this.statusCode = v; return this; }, json(v) { this.body = v; return this; },
    end(v) { this.body = v; return this; } };
}
const secret = 'editorial-test-cron-secret-32-characters';
const headers = { host: 'autovalorpt.example', origin: 'https://autovalorpt.example' };
function setup() {
  const calls = [];
  const publisher = Object.fromEntries(['status', 'preview', 'validate', 'run', 'setEnabled'].map(name => [name,
    async (...args) => { calls.push([name, ...args]); return { ok: true, status: 'prepared' }; }]));
  const handler = createInstagramEditorialHandler({ env: { CRON_SECRET: secret }, publisher,
    authorizeAdmin: req => Boolean(req.admin), report: () => {} });
  const invoke = async (request = {}) => {
    const res = response();
    await handler({ method: 'GET', headers: {}, query: {}, ...request }, res);
    return res;
  };
  return { publisher, calls, invoke };
}

test('private editorial reads and writes never run without a valid session or cron bearer', async () => {
  const { invoke, calls } = setup();
  for (const action of ['status', 'preview', 'settings', 'validate', 'run']) {
    assert.equal((await invoke({ query: { action } })).statusCode, 401);
    assert.equal((await invoke({ query: { action }, headers: { authorization: 'Bearer wrong' } })).statusCode, 401);
  }
  assert.equal(calls.length, 0);
});

test('admin mutations require POST and an explicit matching origin', async () => {
  const { invoke, calls } = setup();
  for (const action of ['settings', 'validate', 'run']) {
    assert.equal((await invoke({ admin: true, query: { action }, headers })).statusCode, 403);
    assert.equal((await invoke({ admin: true, method: 'POST', query: { action }, headers: { host: headers.host } })).statusCode, 403);
    assert.equal((await invoke({ admin: true, method: 'POST', query: { action }, headers: { ...headers, origin: 'https://other.example' } })).statusCode, 403);
  }
  assert.equal(calls.length, 0);
  await invoke({ admin: true, method: 'POST', query: { action: 'settings' }, headers, body: { enabled: false } });
  assert.deepEqual(calls, [['setEnabled', false]]);
});

test('cron receives only the validated seasonal guard, never a caller-supplied publication date', async () => {
  const { invoke, calls } = setup();
  const res = await invoke({ query: { action: 'run', season: 'winter', date: '2099-01-01' }, headers: { authorization: `Bearer ${secret}` } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [['run', { season: 'winter' }]]);
  assert.equal((await invoke({ query: { action: 'settings' }, method: 'POST', body: { enabled: true }, headers: { authorization: `Bearer ${secret}` } })).statusCode, 403);
  assert.equal((await invoke({ admin: true, query: { action: 'preview', date: ['2026-11-21'] } })).statusCode, 400);
});

test('bad settings and exceptions do not expose credentials or falsely confirm publication', async () => {
  const { invoke, publisher, calls } = setup();
  assert.equal((await invoke({ admin: true, method: 'POST', query: { action: 'settings' }, headers, body: { enabled: 'true' } })).statusCode, 400);
  assert.equal(calls.length, 0);
  publisher.run = async () => { throw Object.assign(new Error('token=private-secret'), { code: 'meta_transport_unknown' }); };
  const result = await invoke({ admin: true, method: 'POST', query: { action: 'run' }, headers });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.publicationConfirmed, false);
  assert.equal(result.body.inspectStatusBeforeRetry, true);
  assert.doesNotMatch(JSON.stringify(result), /private-secret/);
});

test('public image route accepts authored date/slide only and handles cache without rendering', async () => {
  let renders = 0;
  const handler = createEditorialImageHandler({ version: 'v1',
    planFor: date => { if (date !== '2026-11-21') throw new Error(); return { id: 'one', slides: [{}] }; },
    render: async () => { renders++; return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); } });
  const invoke = async (query, extra = {}) => { const res = response(); await handler({ method: 'GET', headers: {}, query, ...extra }, res); return res; };
  for (const query of [
    { date: '2026-11-21', src: 'https://127.0.0.1' }, { date: '../../secret' },
    { date: '2026-11-21', v: 'old-version' }, { date: '2026-11-21', slide: ['1'] },
  ]) assert.equal((await invoke(query)).statusCode, 400);
  const query = { date: '2026-11-21', slide: '1', v: 'v1' };
  assert.equal((await invoke(query, { method: 'HEAD' })).statusCode, 200);
  assert.equal(renders, 0);
  const first = await invoke(query);
  assert.equal(first.headers['Content-Type'], 'image/jpeg');
  assert.equal(renders, 1);
  assert.equal((await invoke(query, { headers: { 'if-none-match': first.headers.ETag } })).statusCode, 304);
  assert.equal((await invoke(query)).statusCode, 200);
  assert.equal(renders, 1);
  assert.equal((await invoke({ ...query, slide: '2' })).statusCode, 404);
});

test('stock routing exposes neither editorial management nor arbitrary media fetches', async () => {
  for (const query of [{ integration: 'editorial', action: 'status' }, { integration: 'editorial', action: 'run' }]) {
    const res = response(); await stockHandler({ method: 'GET', headers: {}, query }, res);
    assert.equal(res.statusCode, 401);
  }
  const res = response();
  await stockHandler({ method: 'GET', headers: {}, query: { integration: 'editorial-image', src: 'https://127.0.0.1' } }, res);
  assert.equal(res.statusCode, 400);
  for (const request of [
    { method: 'POST', query: { integration: 'editorial-post', date: '2026-11-21' } },
    { method: 'GET', query: { integration: 'editorial-post', date: '../../state' } },
  ]) {
    const receipt = response(); await stockHandler({ ...request, headers: {} }, receipt);
    assert.equal(receipt.statusCode, request.method === 'POST' ? 405 : 404);
  }
});
