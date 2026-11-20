import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogImageHandler } from '../lib/catalog-image-handler.js';
import stockHandler from '../api/stock.js';

const hash = 'a'.repeat(64); const id = 'ID8Q1lYB';
function response() {
  return { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; }, end() { return this; } };
}
test('public image reads serve only an approved id/hash and allow safe cacheable HEAD checks', async () => {
  const calls = []; const buffer = Buffer.from('approved bytes');
  const handler = createCatalogImageHandler({ source: { image: async (...args) => { calls.push(args);
    return { buffer, hash, mimeType: 'image/png' }; }, prepare() { throw new Error('public mutation'); } } });
  for (const method of ['GET', 'HEAD']) {
    const res = response(); await handler({ method, query: { id, asset: hash } }, res);
    assert.equal(res.code, 200); assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /immutable/); assert.equal(res.body, method === 'GET' ? buffer : undefined);
  }
  for (const query of [{ id, asset: '../private' }, { id: ['ID8Q1lYB'], asset: hash }, { url: 'https://example.org/photo.jpg' }]) {
    const res = response(); await handler({ method: 'GET', query }, res); assert.equal(res.code, 400);
  }
  const res = response(); await handler({ method: 'POST', query: { id, asset: hash } }, res);
  assert.equal(res.code, 405); assert.deepEqual(calls, [[id, hash], [id, hash]]);
});
test('missing or corrupt image storage never returns a substitute or internal provider details', async () => {
  for (const [code, expected] of [['catalog_image_not_found', 404], ['catalog_image_asset_invalid', 503]]) {
    const handler = createCatalogImageHandler({ source: { image: async () => { throw Object.assign(new Error('private provider'), { code }); } } });
    const res = response(); await handler({ method: 'GET', query: { id, asset: hash } }, res);
    assert.equal(res.code, expected); assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(JSON.stringify(res.body).includes('private provider'), false);
  }
  const res = response(); await stockHandler({ method: 'GET', query: { integration: 'catalog-image', id: '../private', asset: hash } }, res);
  assert.equal(res.code, 400);
});
