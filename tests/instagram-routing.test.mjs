import test from 'node:test';
import assert from 'node:assert/strict';
import stockHandler from '../api/stock.js';

async function invoke(query, method = 'GET') {
  const res = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await stockHandler({ method, query, headers: {} }, res);
  return res;
}

test('existing stock route delegates private Instagram modes without exposing unauthenticated access', async () => {
  const sync = await invoke({ integration: 'instagram-sync', action: 'run' });
  assert.equal(sync.statusCode, 401); assert.equal(sync.body.error, 'private_access_required');
  const image = await invoke({ integration: 'instagram-image', src: 'https://127.0.0.1/' });
  assert.equal(image.statusCode, 403); assert.equal(image.body.error, 'image_access_invalid');
});

test('stock method handling remains unchanged without an exact integration selector', async () => {
  for (const query of [undefined, {}, { integration: 'instagram-sync-other' }, { action: 'instagram-sync' }]) {
    const result = await invoke(query, 'POST'); assert.equal(result.statusCode, 405); assert.equal(result.body.error, 'Use GET.');
  }
});
