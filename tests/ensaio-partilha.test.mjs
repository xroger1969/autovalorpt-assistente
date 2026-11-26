import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createShareRehearsalHandler } from '../api/ensaio-partilha.js';

const preview = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/ensaio-partilha-telemovel' };
const origin = 'https://ensaio.example.test';
const sample = '/api/stock?integration=editorial-image&date=2099-01-01&slide=1&v=v4&variant=wa1';
const tips = '/api/stock?integration=whatsapp-status&action=tip-';

async function request(env = preview, query = {}, method = 'GET') {
  const res = { headers: new Map(), setHeader(key, value) { this.headers.set(key, value); },
    status(value) { this.statusCode = value; return this; }, end(body) { this.body = body; } };
  await createShareRehearsalHandler(env)({ query, method }, res);
  return res;
}

test('the rehearsal serves only the protected preview branch and only read methods', async () => {
  for (const env of [{}, { ...preview, VERCEL_ENV: 'production' }, { ...preview, VERCEL_GIT_COMMIT_REF: 'other-preview' }]) {
    assert.equal((await request(env)).statusCode, 404);
  }
  assert.equal((await request(preview, {}, 'POST')).statusCode, 405);
  assert.equal((await request(preview, { recurso: '../package.json' })).statusCode, 404);
  const page = await request();
  assert.equal(page.statusCode, 200);
  assert.match(page.headers.get('Content-Security-Policy'), /connect-src 'none'/);
  assert.match(page.headers.get('Cache-Control'), /no-store/);
  assert.match(page.body.toString(), /Ensaio de partilha em telemóvel/);
  const asset = await request(preview, { recurso: 'amostra.jpg' });
  assert.equal(asset.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(asset.body.readUInt16BE(), 0xffd8);
  const deployed = await request(preview, { recurso: 'whatsapp-editorial.js' });
  assert.deepEqual(deployed.body, await readFile(new URL('../whatsapp-editorial.js', import.meta.url)));
});

test('the in-page rehearsal reserves and releases a fictitious item, without forwarding any requests', async () => {
  const guide = await request(preview, { recurso: 'guia.js' });
  const context = { URL, Response, Uint8Array, atob, location: { origin }, document: { addEventListener() {} },
    fetch() { assert.fail('Fixture must not forward requests'); } };
  runInNewContext(guide.body, context);
  const call = (action, body) => context.fetch(tips + action, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
  const id = 'ensaio-partilha';
  const requestId = '12345678-1234-4234-8234-123456789abc';
  assert.equal((await (await call('list')).json()).items[0].status, 'ready');
  assert.ok((await (await context.fetch(sample)).blob()).size > 0);
  assert.deepEqual(await (await call('claim', { id, requestId })).json(), { ok: true, status: 'unconfirmed', attemptId: requestId });
  assert.equal((await (await call('list')).json()).items[0].attemptId, requestId);
  assert.equal((await call('confirm', { id, attemptId: requestId, observed: true })).status, 404);
  assert.equal((await call('release', { id, attemptId: requestId, notSent: true })).status, 200);
  assert.equal((await (await call('list')).json()).items[0].status, 'ready');
  assert.equal((await context.fetch('https://other.example/')).status, 404);
});
