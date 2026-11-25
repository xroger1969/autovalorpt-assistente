import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualStoryPublisher } from '../lib/manual-story-publisher.js';
import { createInstagramSyncHandler } from '../lib/instagram-sync-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const id = 'ID8Q1pSL', fingerprint = 'b'.repeat(64);
const env = { VERCEL_ENV: 'production', ADMIN_SESSION_SECRET: 'production-session-mock-secret-for-tests',
  INSTAGRAM_USER_ID: '1234512345', INSTAGRAM_STORIES_ENABLED: 'true' };
const historyPath = 'instagram/v1/production/manual-stories/' + id + '.json';

function fixture(overrides = {}) {
  const memory = memoryBlob();
  const calls = [];
  let clock = Date.parse('2026-11-26T17:00:00Z');
  const state = () => JSON.parse(memory.records.get(historyPath).text);
  const quota = { usage: 12, total: 100 };
  const videos = {
    preview: async () => ({ id, fingerprint, ok: true, status: 'preview_ready', videoUrl: 'https://test.example/preview' }),
    validate: async (selected, hash) => {
      calls.push('validate');
      assert.equal(selected, id);
      assert.equal(hash, fingerprint);
      return { videoUrl: 'https://test.example/verified' };
    }, ...overrides.videos,
  };
  const provider = {
    authorize: async () => { calls.push('auth'); return { ready: true, publishingQuota: quota }; },
    quota: async () => { calls.push('quota'); return quota; },
    create: async url => { assert.equal(url, 'https://test.example/verified'); calls.push('create'); return { id: '7890123' }; },
    inspect: async container => { assert.equal(container, '7890123'); calls.push('inspect'); return { status_code: 'FINISHED' }; },
    publish: async container => {
      assert.equal(container, '7890123'); calls.push('publish');
      assert.equal(state().attempts.at(-1).phase, 'publishing');
      return { id: '7777777' };
    }, ...overrides.provider,
  };
  const service = createManualStoryPublisher({ env: { ...env, ...overrides.env }, storage: memory.storage,
    now: () => clock, pollAttempts: 0, provider, videos });
  const review = async () => ({ ...await service.preview(id), confirmed: true });
  return { service, memory, calls, state, review, advance: ms => { clock += ms; }, provider, videos };
}

test('parallel reviews, duplicate clicks and old retries share a single durable send; a fresh review can explicitly republish', async () => {
  const f = fixture();
  const old = await f.review();
  f.advance(100);
  const secondTab = await f.review();
  assert.equal(old.previousPublishedAt, null);
  assert.equal(f.memory.records.size, 0);
  assert.deepEqual(f.calls, []);
  const results = await Promise.all([f.service.publish(old), f.service.publish(secondTab)]);
  assert.deepEqual(results.map(result => result.status).sort(), ['busy', 'published']);
  assert.equal((await f.service.status(old)).status, 'published');
  assert.equal((await f.service.publish(secondTab)).status, 'published');
  assert.equal(f.calls.filter(call => call === 'publish').length, 1);
  const next = await f.review();
  assert.ok(Date.parse(next.previousPublishedAt));
  assert.notEqual(next.reviewToken, old.reviewToken);
  assert.equal((await f.service.publish(next)).status, 'published');
  assert.equal(f.state().attempts.length, 2);
  assert.deepEqual([...f.memory.records.keys()], [historyPath]);
  await f.service.publish(old);
  assert.equal(f.calls.filter(call => call === 'publish').length, 2);
});

test('mutated binding, missing confirmation, expired reviews and non-production cannot create media', async () => {
  const f = fixture(), reviewed = await f.review();
  for (const patch of [{ id: 'ID8xxxxx' }, { fingerprint: 'e'.repeat(64) }, { reviewToken: reviewed.reviewToken + 'x' }, { confirmed: false }]) {
    await assert.rejects(f.service.publish({ ...reviewed, ...patch }), /story_manual_/);
  }
  f.advance(7200001);
  assert.equal((await f.service.status(reviewed)).status, 'ready');
  await assert.rejects(f.service.publish(reviewed), /expired/);
  await assert.rejects(fixture({ env: { VERCEL_ENV: 'preview' } }).review(), /production_required/);
  assert.deepEqual(f.calls, []);
});

test('sold or changed vehicle after preparation is durably canceled without consuming schedule or posting', async () => {
  let validations = 0;
  const f = fixture({ videos: { validate: async () => {
    if (++validations === 2) throw Object.assign(new Error(), { code: 'story_vehicle_unavailable' });
    return { videoUrl: 'https://test.example/verified' };
  } } });
  const reviewed = await f.review();
  assert.equal((await f.service.publish(reviewed)).status, 'canceled');
  assert.equal((await f.service.status(reviewed)).reason, 'story_vehicle_unavailable');
  assert.equal(f.calls.includes('publish'), false);
  assert.equal(f.state().attempts[0].phase, 'canceled');
});

test('provider permissions and remaining capacity checked before container and immediately before public send', async () => {
  for (const config of [
    { authorize: async () => ({ ready: false, reason: 'wrong_story_account' }) },
    { authorize: async () => ({ ready: true, publishingQuota: { usage: 7, total: 10 } }) },
    { quota: async () => ({ usage: 7, total: 10 }) },
  ]) {
    const f = fixture({ provider: config });
    const reviewed = await f.review(), result = await f.service.publish(reviewed);
    assert.equal(result.status, 'authorization_required');
    assert.equal(f.calls.filter(x => x === 'create').length, config.quota ? 1 : 0);
    assert.equal(f.calls.includes('publish'), false);
  }
});

test('resuming a preparing container after reload publishes exactly once', async () => {
  let remote = 'IN_PROGRESS';
  const f = fixture({ provider: { inspect: async () => ({ status_code: remote }) } });
  const reviewed = await f.review();
  assert.equal((await f.service.publish(reviewed)).status, 'preparing');
  const other = await f.review();
  assert.equal((await f.service.status(other)).status, 'preparing');
  remote = 'FINISHED';
  const result = await f.service.publish(other);
  assert.equal(result.status, 'published');
  assert.equal(f.calls.filter(x => x === 'create').length, 1);
  assert.equal(f.calls.filter(x => x === 'publish').length, 1);
});

test('ambiguous Meta response and a lost confirmation write each block repeat sends; only positive readback repairs history', async () => {
  for (const fault of ['transport', 'confirmation']) {
    let remote = 'FINISHED', sends = 0;
    const f = fixture({ provider: {
      inspect: async () => ({ status_code: remote }),
      publish: async () => { sends++; if (fault === 'transport') throw new Error('network'); return { id: '33333333' }; },
    } });
    if (fault === 'confirmation') f.memory.faults.put = (_path, state) => state.attempts.at(-1).phase === 'published';
    const reviewed = await f.review();
    if (fault === 'transport') assert.equal((await f.service.publish(reviewed)).status, 'review_required');
    else await assert.rejects(f.service.publish(reviewed), /storage write failure/);
    const next = await f.review();
    assert.equal(next.publicationEnabled, false);
    assert.equal((await f.service.publish(next)).status, 'review_required');
    assert.equal((await f.service.status(reviewed)).status, 'review_required');
    remote = 'PUBLISHED';
    delete f.memory.faults.put;
    f.advance(7500000);
    assert.equal((await f.service.status(reviewed)).status, 'published');
    assert.equal((await f.service.publish(reviewed)).status, 'published');
    assert.equal(sends, 1);
  }
});

test('manual endpoints require admin and POST JSON confirmation; workers, cron and cross-origin requests cannot publish', async () => {
  const secret = 'a'.repeat(40);
  let sent = 0;
  const handler = createInstagramSyncHandler({ env: { ...env, INSTAGRAM_STORY_WORKER_SECRET: secret, CRON_SECRET: secret },
    authorizeAdmin: req => req.headers.cookie === 'admin', manualPublisher: { publish: () => { sent++; return { ok: true }; } } });
  const run = async (method, headers, body) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await handler({ method, query: { action: 'stories-manual-publish' }, headers, body }, res);
    return res.code;
  };
  const admin = { cookie: 'admin', host: 'autovalorpt.example', origin: 'https://autovalorpt.example', 'content-type': 'application/json' };
  assert.equal(await run('POST', { authorization: 'Bearer ' + secret }, { id, confirmed: true }), 401);
  assert.equal(await run('GET', admin), 405);
  assert.equal(await run('POST', { ...admin, origin: 'https://other.example' }, { id, confirmed: true }), 403);
  assert.equal(await run('POST', { ...admin, 'content-type': 'text/plain' }, { id, confirmed: true }), 403);
  assert.equal(await run('POST', admin, { id }), 400);
  assert.equal(sent, 0);
  assert.equal(await run('POST', admin, { id, confirmed: true }), 200);
  assert.equal(sent, 1);
});

test('uncertain older fingerprint has an exact status receipt and never reports the replacement video published', async () => {
  let current = fingerprint, remote = 'FINISHED';
  const f = fixture({ videos: { preview: async () => ({ id, fingerprint: current, ok: true, status: 'preview_ready' }) },
    provider: { inspect: async () => ({ status_code: remote }), publish: async () => { throw new Error('network'); } } });
  const first = await f.review();
  assert.equal((await f.service.publish(first)).status, 'review_required');
  current = 'c'.repeat(64);
  const changed = await f.review();
  assert.equal(changed.publicationEnabled, false);
  assert.equal(changed.pendingPublication.fingerprint, first.fingerprint);
  remote = 'PUBLISHED';
  assert.equal((await f.service.status(changed)).status, 'review_required');
  assert.equal((await f.service.publish(changed)).status, 'review_required');
  assert.equal((await f.service.status(changed.pendingPublication)).status, 'published');
  assert.equal((await f.service.publish(changed)).status, 'canceled');
  assert.equal((await f.review()).publicationEnabled, true);
});

test('full admin route uses the verified Instagram account and resolves the private token once across inventory checks and container polls', async () => {
  const memory = memoryBlob();
  const videoUrl = 'https://private.example/video';
  let resolutions = 0, polls = 0;
  const posts = [];
  const handler = createInstagramSyncHandler({ env, storage: memory.storage, authorizeAdmin: () => true,
    tokenManager: { resolve: async () => { resolutions++; return 'simulated'; } }, pause: async () => {},
    manualVideos: {
      preview: async () => ({ ok: true, status: 'preview_ready', id, fingerprint, videoUrl }),
      validate: async () => ({ videoUrl }),
    },
    fetchImpl: async (address, init) => {
      const url = new URL(address);
      assert.equal(url.hostname, 'graph.instagram.com');
      assert.equal(init.headers.Authorization, 'Bearer simulated');
      const endpoint = url.pathname.split('/').at(-1);
      if (init.method === 'POST') posts.push(endpoint);
      switch (endpoint) {
        case 'me': return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: 'autovalorpt', account_type: 'BUSINESS' });
        case 'content_publishing_limit': return Response.json({ data: [{ quota_usage: 5, config: { quota_total: 100 } }] });
        case 'media': assert.equal(new URLSearchParams(init.body).get('video_url'), videoUrl); return Response.json({ id: '555555' });
        case '555555': return Response.json({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' });
        case 'media_publish': assert.equal(new URLSearchParams(init.body).get('creation_id'), '555555'); return Response.json({ id: '777777' });
        default: throw new Error('unexpected simulated endpoint');
      }
    },
  });
  const request = async (action, body) => {
    const res = { setHeader() {}, status(code) { assert.equal(code, 200); return this; }, json(value) { this.body = value; } };
    await handler({ method: 'POST', headers: { origin: 'https://test.example', host: 'test.example', 'content-type': 'application/json' },
      query: { action: 'stories-manual-' + action }, body }, res);
    return res.body;
  };
  const review = await request('preview', { id });
  assert.equal(resolutions, 0);
  assert.equal((await request('publish', { ...review, confirmed: true })).status, 'published');
  assert.equal(resolutions, 1);
  assert.deepEqual(posts, ['media', 'media_publish']);
  assert.equal(polls, 3);
});
