import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramTokenManager } from '../lib/instagram-token.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const DAY = 86400_000;
const PATH = 'instagram/v1/production/auth.json';

function fixture(overrides = {}) {
  const memory = memoryBlob(); let clock = 1794000000000;
  const env = { VERCEL_ENV: 'production', INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_ACCESS_TOKEN: 'synthetic-bootstrap-token-only', INSTAGRAM_TOKEN_EXPIRES_AT: new Date(clock + 60 * DAY).toISOString(), ADMIN_SESSION_SECRET: 'synthetic-secret-at-least-32-characters', INSTAGRAM_GRAPH_VERSION: 'v26.0', ...overrides };
  const calls = []; let refreshCount = 0; let failRefresh = false; let wrongAccount = false; let pauseRefresh = null; let invalidRefresh = false; let refreshExpiresIn = 60 * 86400;
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    const parsed = new URL(url); const isRefresh = parsed.pathname === '/refresh_access_token';
    const token = String(options.headers.Authorization).replace(/^Bearer /, '');
    // Keep only non-sensitive call metadata, including in tests.
    calls.push({ path: parsed.pathname, isRefresh, tokenIndex: token === env.INSTAGRAM_ACCESS_TOKEN ? 'bootstrap' : 'renewed' });
    if (isRefresh) {
      assert.equal(parsed.origin, 'https://graph.instagram.com');
      assert.equal(parsed.searchParams.get('grant_type'), 'ig_refresh_token');
      assert.equal(parsed.searchParams.get('access_token'), token);
      refreshCount++;
      if (pauseRefresh) await pauseRefresh;
      if (failRefresh) throw new Error(`provider URL includes ${token} must never escape`);
      return Response.json(invalidRefresh ? { access_token: 'not enough', expires_in: 60 * 86400 } : { access_token: `synthetic-renewed-token-${refreshCount}`, token_type: 'bearer', expires_in: refreshExpiresIn });
    }
    return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: wrongAccount && token !== env.INSTAGRAM_ACCESS_TOKEN ? 'someone_else' : 'autovalorpt' });
  };
  const make = () => createInstagramTokenManager({ env, storage: memory.storage, fetchImpl, now: () => clock });
  return { memory, env, calls, make, manager: make(), advance: (ms) => { clock += ms; }, now: () => clock,
    setFail: (value) => { failRefresh = value; }, setWrong: (value) => { wrongAccount = value; }, setInvalid: (value) => { invalidRefresh = value; },
    setExpirySeconds: (value) => { refreshExpiresIn = value; },
    holdRefresh: () => { let release; pauseRefresh = new Promise((resolve) => { release = resolve; }); return () => { release(); pauseRefresh = null; }; },
    refreshCount: () => refreshCount };
}

test('bootstrap stays encrypted, status has no credentials, and refresh waits at least 24 hours', async () => {
  const f = fixture(); assert.equal(await f.manager.resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
  const stored = f.memory.records.get(PATH).text; assert.equal(stored.includes(f.env.INSTAGRAM_ACCESS_TOKEN), false);
  const envelope = JSON.parse(stored); assert.ok(envelope.ciphertext); assert.ok(envelope.iv); assert.ok(envelope.tag);
  f.advance(24 * 3600_000); await f.manager.resolve(); assert.equal(f.refreshCount(), 0);
  f.advance(3600_000); assert.match(await f.manager.resolve(), /^synthetic-renewed-token/); assert.equal(f.refreshCount(), 1);
  const status = await f.manager.status(); assert.equal(Date.parse(status.expiresAt), f.now() + 60 * DAY);
  assert.equal(JSON.stringify(status).includes('synthetic'), false);
});

test('renewed token survives a new process and refreshes weekly with provider-returned expiry', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000);
  const renewed = await f.manager.resolve(); const nextProcess = f.make(); assert.equal(await nextProcess.resolve(), renewed);
  f.advance(6 * DAY); assert.equal(await nextProcess.resolve(), renewed); assert.equal(f.refreshCount(), 1);
  f.advance(DAY); assert.notEqual(await nextProcess.resolve(), renewed); assert.equal(f.refreshCount(), 2);
});

test('shorter long-lived renewals refresh one day before expiry and never before 24 hours', async () => {
  for (const days of [3, 5]) {
    const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); f.setExpirySeconds(days * 86400);
    const renewed = await f.manager.resolve(); const status = await f.manager.status();
    assert.equal(Date.parse(status.expiresAt), f.now() + days * DAY);
    assert.equal(Date.parse(status.nextRefreshAt), f.now() + (days - 1) * DAY);
    f.advance((days - 1) * DAY - 1); assert.equal(await f.make().resolve(), renewed); assert.equal(f.refreshCount(), 1);
    f.advance(1); assert.notEqual(await f.make().resolve(), renewed); assert.equal(f.refreshCount(), 2);
  }
});

test('renewals valid for less than three days preserve the previous authorization', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); f.setExpirySeconds(3 * 86400 - 1);
  assert.equal(await f.manager.resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
  const status = await f.manager.status(); assert.equal(status.lastError, 'refresh_failed');
  assert.equal(status.expiresAt, f.env.INSTAGRAM_TOKEN_EXPIRES_AT);
});

test('concurrent refresh uses one CAS lease; the loser cannot replace the new token', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000);
  const release = f.holdRefresh(); const first = f.manager.resolve();
  for (let i = 0; i < 20 && f.refreshCount() === 0; i++) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(f.make().resolve(), { code: 'token_refresh_busy' }); release();
  const token = await first; assert.equal(f.refreshCount(), 1); assert.equal(await f.make().resolve(), token);
});

test('expired tokens require reconnect and are never silently replaced by the old bootstrap', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); await f.manager.resolve();
  f.advance(61 * DAY); await assert.rejects(f.make().resolve(), { code: 'instagram_reconnect_required' });
  assert.equal(f.refreshCount(), 1); assert.equal((await f.manager.status()).expired, true);
});

test('refresh failure preserves current token, backs off one day, and suppresses provider details', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); f.setFail(true);
  assert.equal(await f.manager.resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
  const status = await f.manager.status(); assert.equal(status.lastError, 'refresh_failed'); assert.equal(JSON.stringify(status).includes('synthetic'), false);
  assert.equal(await f.make().resolve(), f.env.INSTAGRAM_ACCESS_TOKEN); assert.equal(f.refreshCount(), 1);
  f.setFail(false); f.advance(DAY); assert.match(await f.manager.resolve(), /^synthetic-renewed-token/);
});

test('returned credentials for a different account are rejected before storage', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); f.setWrong(true);
  await assert.rejects(f.manager.resolve(), { code: 'wrong_instagram_account' });
  assert.equal((await f.manager.status()).lastError, 'wrong_instagram_account');
  assert.equal(await f.make().resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
});

test('malformed refresh response cannot replace an existing authorization', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); f.setInvalid(true);
  assert.equal(await f.manager.resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
  assert.equal((await f.manager.status()).lastError, 'refresh_failed');
});

test('manual bootstrap rotation discards the old token only after verifying the replacement', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000); await f.manager.resolve();
  f.env.INSTAGRAM_ACCESS_TOKEN = 'synthetic-replacement-bootstrap-token';
  const rotated = f.make(); assert.equal(await rotated.resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
  assert.equal((await rotated.status()).expiresAt, f.env.INSTAGRAM_TOKEN_EXPIRES_AT); assert.equal(f.refreshCount(), 1);
});

test('tampered ciphertext fails closed; rotating encryption key requires valid bootstrap', async () => {
  const f = fixture(); await f.manager.resolve();
  const raw = f.memory.records.get(PATH); const envelope = JSON.parse(raw.text); envelope.tag = Buffer.alloc(16).toString('base64'); raw.text = JSON.stringify(envelope);
  await assert.rejects(f.make().resolve(), { code: 'token_store_unreadable' });
  f.env.ADMIN_SESSION_SECRET = 'synthetic-rotated-secret-at-least-32-characters';
  assert.equal(await f.make().resolve(), f.env.INSTAGRAM_ACCESS_TOKEN);
});

test('storage failure after renewal prevents using an unpersisted credential', async () => {
  const f = fixture(); await f.manager.resolve(); f.advance(25 * 3600_000);
  let writes = 0; f.memory.faults.put = (path) => path === PATH && ++writes === 2;
  await assert.rejects(f.manager.resolve(), { code: 'token_store_unavailable' });
  f.memory.faults.put = null;
  await assert.rejects(f.make().resolve(), { code: 'token_refresh_busy' });
  f.advance(91_000); assert.match(await f.make().resolve(), /^synthetic-renewed-token/);
});

test('Facebook mode skips token storage and refresh; preview cannot refresh Instagram', async () => {
  const facebook = fixture({ INSTAGRAM_LOGIN_MODE: 'facebook' }); assert.equal(await facebook.manager.resolve(), facebook.env.INSTAGRAM_ACCESS_TOKEN);
  assert.equal(facebook.calls.length, 0); assert.equal(facebook.memory.records.size, 0);
  const preview = fixture({ VERCEL_ENV: 'preview' }); await assert.rejects(preview.manager.resolve(), { code: 'production_required' }); assert.equal(preview.calls.length, 0);
});

test('bootstrap requires known long-lived expiry and rejects short-lived or stale tokens', async () => {
  for (const expiry of ['', 'invalid', new Date(1794000000000 + 3600_000).toISOString(), new Date(1794000000000 - DAY).toISOString()]) {
    const f = fixture({ INSTAGRAM_TOKEN_EXPIRES_AT: expiry });
    await assert.rejects(f.manager.resolve(), { code: 'long_lived_token_required' });
    assert.equal(f.memory.records.size, 0); assert.equal(f.refreshCount(), 0);
  }
});
