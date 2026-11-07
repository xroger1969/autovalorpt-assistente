import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict as conflict } from './instagram-storage.js';

const DAY = 86400_000;
const REFRESH_INTERVAL = 7 * DAY;
const fail = (code) => Object.assign(new Error(code), { code });
const validToken = (value) => typeof value === 'string' && value.length >= 16 && value.length <= 8192 && !/[\s\u0000-\u001f]/.test(value);

// This manager is only for Instagram Login. Facebook/SUAT credentials retain
// their existing server environment handling and never call the refresh API.
export function createInstagramTokenManager(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const legacy = (env.INSTAGRAM_LOGIN_MODE || 'instagram') === 'instagram';
  const path = 'instagram/v1/production/auth.json';
  const accountId = String(env.INSTAGRAM_USER_ID || '');
  const bootstrap = String(env.INSTAGRAM_ACCESS_TOKEN || '');
  const secret = String(env.ADMIN_SESSION_SECRET || '');
  const context = `autovalorpt:instagram-token:v1:${accountId}`;

  function encryptionKey() {
    if (secret.length < 32) throw fail('token_encryption_not_configured');
    return Buffer.from(hkdfSync('sha256', secret, 'autovalorpt:instagram-token', context, 32));
  }
  function binding() {
    return createHmac('sha256', encryptionKey()).update(bootstrap).digest('hex');
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    cipher.setAAD(Buffer.from(`${context}:${binding()}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { version: 1, accountId, binding: binding(), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }
  function decrypt(envelope) {
    try {
      const iv = Buffer.from(envelope.iv, 'base64'); const tag = Buffer.from(envelope.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 16000) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
      cipher.setAAD(Buffer.from(`${context}:${binding()}`)); cipher.setAuthTag(tag);
      const value = JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]).toString('utf8'));
      if (!validToken(value.token) || !Number.isFinite(value.issuedAt) || !Number.isFinite(value.nextRefreshAt) ||
        (value.expiresAt !== null && !Number.isFinite(value.expiresAt))) throw new Error();
      return value;
    } catch { throw fail('token_store_unreadable'); }
  }
  async function read() {
    const result = await readInstagramBlob(storage, path, 6000);
    if (!result) return { value: null, etag: null };
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('token_store_unavailable');
    let envelope;
    try { envelope = JSON.parse(await new Response(result.stream).text()); } catch { throw fail('token_store_unreadable'); }
    if (envelope.version !== 1) throw fail('token_store_unreadable');
    // Changing the environment bootstrap token, account or encryption secret
    // deliberately starts fresh, after validating the new authorization.
    if (envelope.accountId !== accountId || envelope.binding !== binding()) return { value: null, etag: result.blob.etag };
    return { value: decrypt(envelope), etag: result.blob.etag };
  }
  async function save(record) {
    const result = await storage.put(path, JSON.stringify(encrypt(record.value)), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(6000),
    });
    if (!result.etag) throw fail('token_store_unavailable');
    record.etag = result.etag;
  }

  async function request(url, token, includeTokenInQuery = false) {
    // Refresh's documented access_token query stays server-side. Never log a
    // URL, response body, exception message or token from this request.
    const destination = new URL(url);
    if (includeTokenInQuery) destination.searchParams.set('access_token', token);
    let response;
    try {
      response = await fetchImpl(destination.href, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (Number(response.headers.get('content-length') || 0) > 32_000 || !response.body) throw fail('token_provider_invalid');
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          bytes += next.value.length; if (bytes > 32_000) throw fail('token_provider_invalid'); chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok || data?.error) throw fail('token_provider_rejected');
      return data;
    } catch (e) { throw fail(e?.code === 'token_provider_rejected' ? e.code : 'token_provider_unavailable'); }
  }

  async function verify(token) {
    const version = env.INSTAGRAM_GRAPH_VERSION || 'v26.0';
    if (!/^v\d{2}\.0$/.test(version)) throw fail('token_api_version_invalid');
    const data = await request(`https://graph.instagram.com/${version}/me?fields=user_id,username`, token);
    if (String(data.user_id) !== accountId || String(data.username).toLowerCase() !== 'autovalorpt') throw fail('wrong_instagram_account');
  }

  async function initialize(record) {
    if (!validToken(bootstrap)) throw fail('token_bootstrap_missing');
    await verify(bootstrap);
    const providedExpiry = Date.parse(env.INSTAGRAM_TOKEN_EXPIRES_AT || '');
    // A short-lived or nearly expired bootstrap cannot survive the first daily
    // refresh window. Require the expiry returned for a fresh long-lived token.
    if (!Number.isFinite(providedExpiry) || providedExpiry < now() + 3 * DAY || providedExpiry > now() + 61 * DAY) throw fail('long_lived_token_required');
    record.value = { token: bootstrap, issuedAt: now(), expiresAt: providedExpiry, nextRefreshAt: now() + 25 * 3600_000, lease: null, lastError: null };
    try { await save(record); return record; }
    catch (e) {
      if (!conflict(e)) throw fail('token_store_unavailable');
      const winner = await read();
      if (!winner.value) throw fail('token_configuration_changed');
      return winner;
    }
  }

  async function status() {
    if (!legacy) return { mode: 'environment', automaticRefresh: false };
    if (!bootstrap || secret.length < 32) return { mode: 'instagram', automaticRefresh: true, initialized: false };
    const { value } = await read();
    return { mode: 'instagram', automaticRefresh: true, initialized: Boolean(value),
      expiresAt: value?.expiresAt ? new Date(value.expiresAt).toISOString() : null,
      nextRefreshAt: value ? new Date(value.nextRefreshAt).toISOString() : null,
      expired: Boolean(value?.expiresAt && value.expiresAt <= now()), lastError: value?.lastError || null };
  }

  async function resolve() {
    if (!legacy) return bootstrap;
    if (env.VERCEL_ENV !== 'production') throw fail('production_required');
    let record = await read();
    if (!record.value) record = await initialize(record);
    const value = record.value;
    if (value.expiresAt && value.expiresAt <= now()) throw fail('instagram_reconnect_required');
    if (now() < value.nextRefreshAt) return value.token;
    if (value.lease?.until > now()) throw fail('token_refresh_busy');
    const oldToken = value.token;
    const claimed = { ...value, lease: { id: randomUUID(), until: now() + 90_000 } };
    record.value = claimed;
    try { await save(record); }
    catch (e) { throw fail(conflict(e) ? 'token_refresh_busy' : 'token_store_unavailable'); }
    let renewed;
    try {
      const data = await request('https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token', oldToken, true);
      if (!validToken(data.access_token) || String(data.token_type).toLowerCase() !== 'bearer' || !Number.isSafeInteger(data.expires_in) || data.expires_in < 3 * 86400 || data.expires_in > 61 * 86400) throw fail('token_provider_invalid');
      await verify(data.access_token);
      renewed = { token: data.access_token, issuedAt: now(), expiresAt: now() + data.expires_in * 1000, nextRefreshAt: now() + Math.min(REFRESH_INTERVAL, data.expires_in * 1000 - DAY), lease: null, lastError: null };
    } catch (e) {
      record.value = { ...value, lease: null, nextRefreshAt: now() + DAY, lastError: e?.code === 'wrong_instagram_account' ? 'wrong_instagram_account' : 'refresh_failed' };
      try { await save(record); } catch { throw fail('token_store_unavailable'); }
      if (e?.code === 'wrong_instagram_account') throw e;
      // Existing authorization is not replaced on a refresh failure. The
      // publisher verifies it again before performing any public action.
      return oldToken;
    }
    record.value = renewed;
    try { await save(record); } catch { throw fail('token_store_unavailable'); }
    return renewed.token;
  }
  return { resolve, status };
}
