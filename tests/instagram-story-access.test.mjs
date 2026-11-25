import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createInstagramSyncHandler } from '../lib/instagram-sync-handler.js';
import { createInstagramVideoHandler, instagramVideoPath, signInstagramVideoUrl, verifyInstagramVideoQuery } from '../lib/instagram-video-access.js';

const env = { VERCEL_ENV: 'production', ADMIN_SESSION_SECRET: 'synthetic-signing-secret-32-characters', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app', INSTAGRAM_STORY_WORKER_SECRET: 'synthetic-story-worker-32-characters' };
const time = Date.parse('2026-11-11T12:00:00Z');
const id = 'ID8new001'; const fingerprint = 'a'.repeat(64);
function query() { return Object.fromEntries(new URL(signInstagramVideoUrl(id, fingerprint, env, time)).searchParams); }
class ResponseMock extends Writable {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.chunks = []; this.headersSent = false; }
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  status(code) { this.statusCode = code; return this; }
  json(value) { this.body = value; this.end(); return this; }
  flushHeaders() { this.headersSent = true; }
}
test('scoped worker can use Story read actions but never legacy actions', async () => {
  const calls = []; const methods = Object.fromEntries(['status', 'dryRun', 'preview', 'run'].map(name => [name, async (...args) => { calls.push({ name, args }); return { ok: true }; }]));
  const handler = createInstagramSyncHandler({ env, stories: methods, publisher: methods, retirements: methods, authorizeAdmin: () => false });
  for (const action of ['stories-status', 'stories-dry-run']) {
    const res = new ResponseMock(); await handler({ method: 'GET', query: { action }, headers: { authorization: `Bearer ${env.INSTAGRAM_STORY_WORKER_SECRET}` } }, res); assert.equal(res.statusCode, 200);
  }
  for (const action of ['status', 'dry-run', 'run', 'retirement-status', 'retirement-dry-run', 'retirement-run']) {
    const res = new ResponseMock(); await handler({ method: 'POST', query: { action }, headers: { authorization: `Bearer ${env.INSTAGRAM_STORY_WORKER_SECRET}` } }, res); assert.equal(res.statusCode, 401);
  }
  assert.deepEqual(calls.map(call => call.name), ['status', 'dryRun']);
});
test('scoped worker mutations require POST and forward only vehicle identifiers', async () => {
  const calls = []; const stories = { preview: async (...args) => { calls.push(args); return { ok: true }; }, run: async (...args) => { calls.push(args); return { ok: true }; } };
  const handler = createInstagramSyncHandler({ env, stories, publisher: {}, retirements: {}, authorizeAdmin: () => false });
  for (const action of ['stories-preview', 'stories-run']) {
    const req = { method: 'GET', query: { action, id, sample_id: id, video_url: 'https://untrusted.example/video.mp4' }, headers: { authorization: `Bearer ${env.INSTAGRAM_STORY_WORKER_SECRET}` } };
    const denied = new ResponseMock(); await handler(req, denied); assert.equal(denied.statusCode, 403);
    const allowed = new ResponseMock(); await handler({ ...req, method: 'POST' }, allowed); assert.equal(allowed.statusCode, 200);
  }
  assert.deepEqual(calls, [[id], [{ sampleId: id }]]);
});
test('missing, short and incorrect worker secrets authorize no Story action', async () => {
  for (const [configured, provided] of [[undefined, 'anything'], ['short', 'short'], [env.INSTAGRAM_STORY_WORKER_SECRET, 'x'.repeat(40)], [env.INSTAGRAM_STORY_WORKER_SECRET, undefined]]) {
    const handler = createInstagramSyncHandler({ env: { ...env, INSTAGRAM_STORY_WORKER_SECRET: configured }, stories: {}, publisher: {}, retirements: {}, authorizeAdmin: () => false });
    const res = new ResponseMock(); await handler({ method: 'GET', query: { action: 'stories-status' }, headers: { ...(provided ? { authorization: `Bearer ${provided}` } : {}) } }, res); assert.equal(res.statusCode, 401);
  }
});
test('signed video capabilities bind ID, content hash, expiry and signing key', () => {
  const signed = query(); assert.equal(verifyInstagramVideoQuery(signed, env, time), instagramVideoPath(id, fingerprint));
  for (const changed of [{ id: 'ID8other01' }, { fingerprint: 'b'.repeat(64) }, { expires: String(Number(signed.expires) + 1) }, { signature: 'x'.repeat(43) }, { id: '../auth.json' }, { id: [id] }, { fingerprint: '../../state.json' }]) assert.equal(verifyInstagramVideoQuery({ ...signed, ...changed }, env, time), null);
  assert.equal(verifyInstagramVideoQuery(signed, env, time + 7201_000), null);
  assert.equal(verifyInstagramVideoQuery(signed, env, time - 1000), null);
  assert.equal(verifyInstagramVideoQuery(signed, { ...env, ADMIN_SESSION_SECRET: 'x'.repeat(40) }, time), null);
  assert.equal(verifyInstagramVideoQuery(signed, { ...env, ADMIN_SESSION_SECRET: 'short' }, time), null);
  assert.equal(new URL(signInstagramVideoUrl(id, fingerprint, env, time)).searchParams.has('access_token'), false);
});
test('signed media supports Safari ranges, seeking, full downloads and reuses immutable metadata', async () => {
  const video = Buffer.from(Array.from({ length: 2048 }, (_, i) => i % 251));
  const calls = [];
  const storage = {
    head: async () => { calls.push('head'); return { size: video.length, contentType: 'video/mp4' }; },
    get: async (path, options) => {
      assert.equal(options.access, 'private');
      calls.push(options.headers?.Range || 'full');
      // Exercise a storage server ignoring the initial two-byte probe.
      if (options.headers?.Range === 'bytes=2000-2047') {
        return { statusCode: 200, stream: new Response(video.subarray(2000)).body, headers: new Headers({ 'Content-Range': 'bytes 2000-2047/2048' }) };
      }
      return { statusCode: 200, stream: new Response(video).body, headers: new Headers() };
    },
  };
  const handler = createInstagramVideoHandler({ env, storage, now: () => time });
  const call = async (method, headers, download) => {
    const res = new ResponseMock();
    await handler({ method, query: { ...query(), download }, headers }, res);
    return res;
  };
  const meta = await call('HEAD');
  assert.equal(meta.statusCode, 200);
  assert.equal(meta.headers['content-length'], '2048');
  assert.deepEqual(calls, ['head']);
  for (const [range, start, end] of [['bytes=0-1', 0, 1], ['bytes=-48', 2000, 2047], ['bytes=1500-', 1500, 2047]]) {
    const res = await call('GET', { range });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['accept-ranges'], 'bytes');
    assert.equal(res.headers['content-range'], `bytes ${start}-${end}/2048`);
    assert.equal(res.headers['content-length'], String(end - start + 1));
    assert.deepEqual(Buffer.concat(res.chunks), video.subarray(start, end + 1));
  }
  const full = await call('GET', {}, '1');
  assert.equal(full.statusCode, 200);
  assert.equal(full.headers['content-type'], 'video/mp4');
  assert.equal(full.headers['cache-control'], 'private, no-store');
  assert.equal(full.headers['content-disposition'], `attachment; filename="AutoValorPT_${id}.mp4"`);
  assert.deepEqual(Buffer.concat(full.chunks), video);
  for (const range of ['bytes=2048-', 'bytes=10-1', 'bytes=-0', 'bytes=0-1,5-10', 'bytes=-']) {
    const res = await call('GET', { range });
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers['content-range'], 'bytes */2048');
  }
  assert.deepEqual(calls, ['head', 'bytes=0-1', 'bytes=2000-2047', 'bytes=1500-2047', 'full']);
});
test('media cannot escape production or read Blob before signature verification', async () => {
  const storage = { head: async () => assert.fail('storage must not be read'), get: async () => assert.fail('storage must not be read') };
  for (const [settings, method, signed, expected] of [[env, 'GET', { ...query(), signature: 'bad' }, 404], [{ ...env, VERCEL_ENV: 'preview' }, 'GET', query(), 404], [env, 'POST', query(), 405]]) {
    const handler = createInstagramVideoHandler({ env: settings, storage, now: () => time }); const res = new ResponseMock(); await handler({ method, query: signed }, res); assert.equal(res.statusCode, expected);
  }
});
test('media rejects an oversized or non-video artifact without streaming', async () => {
  for (const meta of [{ size: 31 * 1024 * 1024, contentType: 'video/mp4' }, { size: 2048, contentType: 'application/json' }]) {
    const handler = createInstagramVideoHandler({ env, now: () => time, storage: { head: async () => meta, get: async () => assert.fail('must not stream') } }); const res = new ResponseMock(); await handler({ method: 'GET', query: query() }, res); assert.equal(res.statusCode, 404);
  }
});

test('continuing a prepared Story requires same-origin explicit admin confirmation', async () => {
  const received = [];
  const handler = createInstagramSyncHandler({ env, authorizeAdmin: req => req.headers.cookie === 'admin',
    stories: { run: async args => { received.push(args); return { ok: true }; } } });
  const admin = { cookie: 'admin', origin: 'https://autovalorpt.example', host: 'autovalorpt.example', 'content-type': 'application/json' };
  const input = { id, attemptId: '11111111-1111-4111-8111-111111111111', confirmed: true };
  async function invoke(method, headers, body) {
    const res = new ResponseMock();
    await handler({ method, headers, body, query: { action: 'stories-resume' } }, res);
    return res.statusCode;
  }
  assert.equal(await invoke('POST', { authorization: `Bearer ${env.INSTAGRAM_STORY_WORKER_SECRET}` }, input), 401);
  assert.equal(await invoke('GET', admin, input), 405);
  assert.equal(await invoke('POST', { ...admin, origin: '' }, input), 403);
  assert.equal(await invoke('POST', admin, { ...input, confirmed: false }), 400);
  assert.equal(await invoke('POST', admin, input), 200);
  assert.deepEqual(received, [{ resume: input }]);
});
