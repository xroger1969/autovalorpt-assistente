import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockFeedHandler, createPublicCatalogFeed } from '../lib/stock-feed-handler.js';

function response() {
  return { headers: {}, code: 200, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } };
}
test('public feed accepts only GET of a validated snapshot and never invokes synchronization', async () => {
  const calls = [];
  const handler = createStockFeedHandler({ source: {
    feed: async id => { calls.push(id); return { csv: 'public-commercial-csv' }; },
    sync: () => { throw new Error('public write'); }
  } });
  for (const snapshot of ['a'.repeat(64), 'latest']) {
    const res = response(); await handler({ method: 'GET', query: { snapshot } }, res);
    assert.equal(res.code, 200); assert.equal(res.body, 'public-commercial-csv');
    assert.equal(res.headers['Content-Type'], 'text/csv; charset=utf-8');
  }
  for (const snapshot of [undefined, '../state.json', ['a'.repeat(64)], 'https://other.example/feed']) {
    const res = response(); await handler({ method: 'GET', query: { snapshot } }, res);
    assert.equal(res.code, 400);
  }
  const res = response(); await handler({ method: 'POST', query: { snapshot: 'latest' } }, res);
  assert.equal(res.code, 405); assert.equal(calls.length, 2);
});
test('unavailable snapshot returns an error rather than an empty replacement catalogue', async () => {
  const handler = createStockFeedHandler({ source: { feed: async () => { throw new Error('private diagnostic'); } } });
  const res = response(); await handler({ method: 'GET', query: { snapshot: 'a'.repeat(64) } }, res);
  assert.equal(res.code, 503); assert.equal(JSON.stringify(res.body).includes('private diagnostic'), false);
  assert.notEqual(res.headers['Content-Type'], 'text/csv; charset=utf-8');
});

test('live feed always has original photos; historical prepared snapshots remain immutable', async () => {
  const calls = []; let code;
  const reader = createPublicCatalogFeed({
    stockSource: { feed: async key => { calls.push(['raw', key]); return { csv: 'raw' }; } },
    catalogSource: { feed: async key => { calls.push(['prepared', key]);
      if (code) throw Object.assign(new Error('private'), { code }); return { csv: 'prepared' }; } },
  });
  assert.equal((await reader.feed('latest')).csv, 'raw');
  assert.deepEqual(calls, [['raw', 'latest']]);
  const historical = 'b'.repeat(64);
  assert.equal((await reader.feed(historical)).csv, 'prepared');
  code = 'catalog_snapshot_not_found';
  assert.equal((await reader.feed(historical)).csv, 'raw');
  for (const failure of ['catalog_snapshot_invalid', 'catalog_storage_unavailable']) {
    code = failure; await assert.rejects(reader.feed(historical), { code: failure });
  }
  assert.equal(calls.filter(([type]) => type === 'raw').length, 2);
});
