import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualVideoJobs } from '../lib/manual-video-jobs.js';
import { createInstagramSyncHandler } from '../lib/instagram-sync-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const id = 'ID8Q1pSL';
const fingerprint = 'b'.repeat(64);
const env = { VERCEL_ENV: 'production', INSTAGRAM_USER_ID: '1234512345' };
const jobPath = `instagram/v1/production/manual-video-jobs/${id}.json`;
const origin = 'https://autovalorpt-assistente.vercel.app';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(extra = {}) {
  const memory = memoryBlob();
  const pending = [], reports = [], calls = [];
  let clock = Date.parse('2026-11-26T17:00:00Z');
  const result = () => ({ ok: true, status: 'preview_ready', id, fingerprint,
    videoUrl: `${origin}/api/stock?integration=instagram-video&id=${id}&fingerprint=${fingerprint}&expires=${Math.floor(clock / 1000) + 7200}`,
    downloadUrl: `${origin}/api/stock?integration=instagram-video&id=${id}&fingerprint=${fingerprint}&expires=${Math.floor(clock / 1000) + 7200}&download=1`,
    reviewToken: `1.${clock + 7200000}.synthetic-private-review`, vehicle: { id, title: 'Viatura de teste', price: '12990.00 EUR' },
    reused: false, publicationEnabled: true, publicationStatus: 'ready', previousPublishedAt: null, pendingPublication: null });
  const manualPublisher = {
    preview: async vehicle => { assert.equal(vehicle, id); calls.push('preview'); return extra.preview ? extra.preview(result) : result(); },
    publish: async () => assert.fail('A video job must never publish to Meta'),
  };
  const options = { env, storage: memory.storage, now: () => clock, manualPublisher,
    waitUntil: work => pending.push(work), report: entry => reports.push(entry), ...extra.options };
  const jobs = createManualVideoJobs(options);
  const receipt = job => ({ id, jobId: job.jobId });
  return { jobs, memory, pending, calls, reports, options, manualPublisher, result, receipt,
    advance: ms => { clock += ms; }, state: () => JSON.parse(memory.records.get(jobPath).text),
    drain: async () => { await Promise.all(pending.splice(0)); } };
}

test('create returns before rendering finishes; another instance reads its complete private preview without work', { timeout: 3000 }, async () => {
  const gate = deferred();
  const f = fixture({ preview: async result => { await gate.promise; return result(); } });
  const job = await f.jobs.create(id);
  assert.equal(job.status, 'preparing');
  assert.match(job.jobId, uuid);
  assert.equal(job.videoUrl, undefined);
  assert.equal(f.calls.length, 1);
  assert.equal(f.pending.length, 1);
  const reader = createManualVideoJobs({ ...f.options, manualPublisher: { preview: () => assert.fail('Progress cannot render') } });
  assert.equal((await reader.progress(f.receipt(job))).status, 'preparing');
  gate.resolve();
  await f.drain();
  const writes = f.memory.calls.filter(call => call.method === 'put').length;
  const prepared = await reader.progress(f.receipt(job));
  assert.deepEqual(prepared, { ...f.result(), jobId: job.jobId, startedAt: job.startedAt });
  assert.equal(f.memory.calls.filter(call => call.method === 'put').length, writes);
  assert.ok(f.memory.calls.filter(call => call.method === 'get').every(call => call.options.access === 'private' && call.options.useCache === false));
  assert.ok(f.memory.calls.filter(call => call.method === 'put').every(call => call.options.access === 'private'));
});

test('video recovery lists existing live jobs and unexpired previews without revealing review material', async () => {
  const gate = deferred();
  const f = fixture({ preview: async result => { await gate.promise; return result(); } });
  const job = await f.jobs.create(id);
  const reader = createManualVideoJobs({ ...f.options, manualPublisher: { preview: () => assert.fail('Recovery cannot render') } });
  const writes = f.memory.calls.filter(call => call.method === 'put').length;
  const entry = { id, jobId: job.jobId, status: 'preparing', startedAt: job.startedAt };
  assert.deepEqual(await reader.recover(), { ok: true, items: [entry], nextCursor: null });
  assert.equal(f.memory.calls.filter(call => call.method === 'put').length, writes);
  const other = createManualVideoJobs({ ...f.options, env: { ...env, INSTAGRAM_USER_ID: '99999999' } });
  assert.deepEqual((await other.recover()).items, []);
  gate.resolve(); await f.drain();
  assert.deepEqual((await reader.recover()).items, [{ ...entry, status: 'preview_ready' }]);
  f.advance(7200001);
  assert.deepEqual((await reader.recover()).items, []);
});

test('video recovery can advance beyond a partial page of older records', async () => {
  const f = fixture();
  await f.jobs.create(id); await f.drain();
  const prefix = 'instagram/v1/production/manual-video-jobs/';
  for (let i = 0; i < 12; i++) {
    const olderId = `ID0demo${String(i).padStart(2, '0')}`;
    const text = i === 0 ? '{corrupt' : JSON.stringify({ ...f.state(), id: olderId, status: 'failed', reason: 'synthetic_failure' });
    f.memory.records.set(prefix + olderId + '.json', { etag: `older-${i}`, text });
  }
  const first = await f.jobs.recover();
  assert.deepEqual(first, { ok: true, items: [], nextCursor: '12', partial: true });
  const second = await f.jobs.recover({ cursor: first.nextCursor });
  assert.equal(second.items[0].id, id);
  assert.equal(second.nextCursor, null);
  await assert.rejects(f.jobs.recover({ cursor: [] }), { code: 'manual_video_recovery_cursor_invalid' });
});

test('concurrent creates in independent instances atomically share one job and one render', async () => {
  const gate = deferred();
  const f = fixture({ preview: async result => { await gate.promise; return result(); } });
  const second = createManualVideoJobs(f.options);
  const jobs = await Promise.all([f.jobs.create(id), second.create(id), f.jobs.create(id)]);
  assert.equal(new Set(jobs.map(job => job.jobId)).size, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.pending.length, 1);
  gate.resolve();
  await f.drain();
  assert.equal((await second.progress(f.receipt(jobs[0]))).status, 'preview_ready');
});

test('interrupted work expires; only an explicit create claims a retry, and a late worker cannot overwrite it', async () => {
  const gates = [deferred(), deferred()];
  let attempt = 0;
  const f = fixture({ preview: async result => { await gates[attempt++].promise; return result(); } });
  const first = await f.jobs.create(id);
  f.advance(300001);
  const old = await f.jobs.progress(f.receipt(first));
  assert.equal(old.status, 'failed');
  assert.equal(old.reason, 'manual_video_job_interrupted');
  assert.equal(f.calls.length, 1);
  const retry = await createManualVideoJobs(f.options).create(id);
  assert.notEqual(retry.jobId, first.jobId);
  assert.equal(f.calls.length, 2);
  gates[0].resolve();
  await f.pending[0];
  assert.equal(f.state().jobId, retry.jobId);
  assert.equal(f.state().status, 'preparing');
  gates[1].resolve();
  await f.drain();
  assert.equal((await f.jobs.progress(f.receipt(retry))).status, 'preview_ready');
  assert.deepEqual(await f.jobs.progress(f.receipt(first)), { ok: false, status: 'failed', id, jobId: first.jobId, reason: 'manual_video_job_not_found' });
});

test('terminal jobs permit a fresh explicit review and reuse the producer cache instead of replaying an expired receipt', async () => {
  let prepared = 0;
  const f = fixture({ preview: async result => ({ ...result(), reused: prepared++ > 0 }) });
  const first = await f.jobs.create(id);
  await f.drain();
  f.advance(7200001);
  assert.equal((await f.jobs.progress(f.receipt(first))).reason, 'manual_video_job_expired');
  const next = await f.jobs.create(id);
  await f.drain();
  assert.notEqual(first.jobId, next.jobId);
  const ready = await f.jobs.progress(f.receipt(next));
  assert.equal(ready.status, 'preview_ready');
  assert.equal(ready.reused, true);
  assert.equal(prepared, 2);
});

test('failed renders are stored with safe codes and never disclose raw messages or become endless jobs', async () => {
  for (const code of ['video_render_timeout', 'TOKEN_SECRET_EXAMPLE']) {
    const f = fixture({ preview: async () => { throw Object.assign(new Error('private raw response credential'), { code }); } });
    const job = await f.jobs.create(id);
    await f.drain();
    const failure = await f.jobs.progress(f.receipt(job));
    assert.equal(failure.status, 'failed');
    assert.equal(failure.reason, code === 'video_render_timeout' ? code : 'manual_video_job_failed');
    assert.doesNotMatch(JSON.stringify([f.state(), f.reports, failure]), /private raw|credential|TOKEN_SECRET/);
    assert.equal(failure.videoUrl, undefined);
  }
});

test('storage errors cannot start unclaimed work or leave an unbounded preparing state', async () => {
  const before = fixture();
  before.memory.faults.put = () => true;
  await assert.rejects(before.jobs.create(id), { code: 'manual_video_job_unavailable' });
  assert.equal(before.calls.length, 0);
  assert.equal(before.pending.length, 0);

  const finishing = fixture();
  finishing.memory.faults.put = (_path, state) => state.status === 'preview_ready';
  const first = await finishing.jobs.create(id);
  await finishing.drain();
  assert.equal((await finishing.jobs.progress(finishing.receipt(first))).status, 'failed');

  const unavailable = fixture();
  let writes = 0;
  unavailable.memory.faults.put = () => ++writes > 1;
  const second = await unavailable.jobs.create(id);
  await unavailable.drain();
  assert.equal(unavailable.state().status, 'preparing');
  unavailable.advance(300001);
  assert.equal((await unavailable.jobs.progress(unavailable.receipt(second))).reason, 'manual_video_job_interrupted');
  delete unavailable.memory.faults.put;
  const retry = await unavailable.jobs.create(id);
  await unavailable.drain();
  assert.equal((await unavailable.jobs.progress(unavailable.receipt(retry))).status, 'preview_ready');
});

test('failed background registration does not start a detached renderer and persists a retryable failure', async () => {
  const f = fixture({ options: { waitUntil: () => { throw new Error('scheduler unavailable'); } } });
  await assert.rejects(f.jobs.create(id), { code: 'manual_video_job_unavailable' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.state().status, 'failed');
  assert.equal(f.state().reason, 'manual_video_job_unavailable');
});

test('unknown, mismatched and invalid job IDs never reveal another job or trigger work', async () => {
  const f = fixture();
  const known = await f.jobs.create(id);
  await f.drain();
  const writes = f.memory.calls.filter(call => call.method === 'put').length;
  const other = '550e8400-e29b-41d4-a716-446655440000';
  const result = await f.jobs.progress({ id, jobId: other });
  assert.deepEqual(result, { ok: false, status: 'failed', id, jobId: other, reason: 'manual_video_job_not_found' });
  assert.equal(JSON.stringify(result).includes(known.jobId), false);
  for (const input of [{ id }, { id, jobId: '' }, { id, jobId: '../private' }, { id: '../private', jobId: other }]) {
    await assert.rejects(f.jobs.progress(input), { code: 'manual_video_job_invalid' });
  }
  assert.equal(f.calls.length, 1);
  assert.equal(f.memory.calls.filter(call => call.method === 'put').length, writes);
  const changedAccount = createManualVideoJobs({ ...f.options, env: { ...env, INSTAGRAM_USER_ID: '99999999' } });
  assert.equal((await changedAccount.progress(f.receipt(known))).reason, 'manual_video_job_not_found');
  await assert.rejects(createManualVideoJobs({ ...f.options, env: { ...env, VERCEL_ENV: 'preview' } }).create(id), { code: 'production_required' });
});

test('new endpoints keep admin-only POST JSON checks, respond 202 before work completes, and progress is read-only', async () => {
  const gate = deferred();
  const f = fixture({ preview: async result => { await gate.promise; return result(); } });
  const secret = 'synthetic-cron-secret-with-more-than-32-characters';
  const handler = createInstagramSyncHandler({ ...f.options, env: { ...env, CRON_SECRET: secret, INSTAGRAM_STORY_WORKER_SECRET: secret },
    authorizeAdmin: req => req.headers.cookie === 'synthetic-admin' });
  const admin = { cookie: 'synthetic-admin', origin, host: new URL(origin).host, 'content-type': 'application/json' };
  const request = async (action, body, method = 'POST', headers = admin) => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, headers, body, query: { action: `stories-manual-${action}` } }, res);
    return res;
  };
  for (const action of ['create', 'progress']) {
    assert.equal((await request(action, { id }, 'GET')).statusCode, 405);
    assert.equal((await request(action, { id }, 'POST', { authorization: `Bearer ${secret}` })).statusCode, 401);
    assert.equal((await request(action, { id }, 'POST', { ...admin, origin: 'https://other.example' })).statusCode, 403);
    assert.equal((await request(action, { id }, 'POST', { ...admin, 'content-type': 'text/plain' })).statusCode, 403);
    assert.equal((await request(action, { id: '../private' })).statusCode, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await request('progress', { id })).statusCode, 400);
  assert.equal((await request('video-recovery', undefined, 'GET', { authorization: `Bearer ${secret}` })).statusCode, 401);
  assert.equal((await request('video-recovery')).statusCode, 405);
  const creation = await request('create', { id });
  assert.equal(creation.statusCode, 202);
  assert.equal(creation.body.status, 'preparing');
  assert.match(creation.headers['Cache-Control'], /private.*no-store/);
  const recovery = await request('video-recovery', undefined, 'GET');
  assert.equal(recovery.statusCode, 200);
  assert.match(recovery.headers['Cache-Control'], /private.*no-store/);
  assert.equal(recovery.body.items[0].jobId, creation.body.jobId);
  const receipt = f.receipt(creation.body);
  assert.equal((await request('progress', receipt)).body.status, 'preparing');
  gate.resolve();
  await f.drain();
  const ready = await request('progress', receipt);
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.body.status, 'preview_ready');
  assert.equal(f.calls.length, 1);
});
