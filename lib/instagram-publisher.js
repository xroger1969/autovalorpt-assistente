import { createHash, randomUUID } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict as conflict } from './instagram-storage.js';
import { instagramImagesConfigured, signInstagramImageUrl, validInstagramImageSource } from './instagram-image.js';
import { createInstagramTokenManager } from './instagram-token.js';

const HEADERS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const EXPECTED_USERNAME = 'autovalorpt';
const numericId = (value) => /^\d{5,30}$/.test(String(value || ''));
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const error = (code) => Object.assign(new Error(code), { code });
const clean = (value, max) => String(value || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function safePublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /\.[a-z]{2,}$/i.test(url.hostname) && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) ? url : null;
  } catch { return null; }
}

export function instagramConfiguration(env = process.env) {
  const mode = env.INSTAGRAM_LOGIN_MODE || 'instagram';
  const version = env.INSTAGRAM_GRAPH_VERSION || 'v26.0';
  const feed = safePublicUrl(env.INSTAGRAM_FEED_URL || '');
  const validFeed = feed?.hostname === 'docs.google.com' && /^\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]+\/(?:export|pub)$/.test(feed.pathname) &&
    (feed.searchParams.get('format') === 'csv' || feed.searchParams.get('output') === 'csv');
  return {
    enabled: env.INSTAGRAM_SYNC_ENABLED === 'true', production: env.VERCEL_ENV === 'production',
    includeExistingStock: env.INSTAGRAM_INCLUDE_EXISTING_STOCK === 'true',
    tokenConfigured: Boolean(env.INSTAGRAM_ACCESS_TOKEN), accountConfigured: numericId(env.INSTAGRAM_USER_ID),
    feedConfigured: Boolean(validFeed), loginMode: mode, graphVersion: version,
    validApi: ['instagram', 'facebook'].includes(mode) && /^v\d{2}\.0$/.test(version), imagesConfigured: instagramImagesConfigured(env),
    username: EXPECTED_USERNAME, maxPostsPerRun: 1,
  };
}

// Strict RFC 4180-style parsing: malformed/truncated rows abort the entire run.
export function parseInstagramFeed(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_FEED_BYTES) throw error('feed_too_large');
  const input = source.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false; let closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (c === '\r' && input[i + 1] === '\n') i++; rows.push(row); row = []; }
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw error('feed_malformed_csv'); field += c; }
  }
  if (quoted) throw error('feed_truncated_csv');
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  while (rows.length && rows.at(-1).length === 1 && !rows.at(-1)[0]) rows.pop();
  if (rows.length < 2 || rows.length > 2001 || JSON.stringify(rows[0]) !== JSON.stringify(HEADERS)) throw error('feed_invalid_headers_or_count');
  const ids = new Set();
  return rows.slice(1).map((values) => {
    if (values.length !== HEADERS.length) throw error('feed_incomplete_row');
    const item = Object.fromEntries(HEADERS.map((key, index) => [key, values[index].trim()]));
    const link = safePublicUrl(item.link); const image = safePublicUrl(item.image_link);
    if (!/^ID[A-Za-z0-9]{5,30}$/.test(item.id) || ids.has(item.id) || !item.title || item.title.length > 200 ||
      !/^\d{1,7}(?:\.\d{2})? EUR$/.test(item.price) || Number(item.price.split(' ')[0]) <= 0 ||
      !link || !(link.hostname === 'standvirtual.com' || link.hostname.endsWith('.standvirtual.com')) || !image || !validInstagramImageSource(item.image_link) ||
      !['in stock', 'out of stock', 'preorder', 'available for order', 'discontinued'].includes(item.availability) ||
      !['new', 'used', 'refurbished'].includes(item.condition)) throw error('feed_invalid_item');
    ids.add(item.id);
    return item;
  });
}

export function instagramCaption(item) {
  const price = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(item.price.split(' ')[0]));
  return [clean(item.title, 200), price, clean(item.description, 1000), 'Mais informações por mensagem privada.', item.link, '#AutoValorPT #CarrosUsados #Portugal'].filter(Boolean).join('\n\n').slice(0, 2200);
}

async function fetchFeed(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(12_000), redirect: 'follow' });
  if (!response.ok || !/text\/csv|application\/(?:csv|octet-stream)/i.test(response.headers.get('content-type') || '')) throw error('feed_unavailable');
  if (Number(response.headers.get('content-length') || 0) > MAX_FEED_BYTES || !response.body) throw error('feed_too_large');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length; if (bytes > MAX_FEED_BYTES) throw error('feed_too_large');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return parseInstagramFeed(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export function createInstagramPublisher(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const storage = options.storage || { get, head, put };
  const now = options.now || (() => Date.now());
  const pause = options.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const config = instagramConfiguration(env);
  const tokens = options.tokenManager || createInstagramTokenManager({ env, storage, fetchImpl, now });
  const timestamp = () => new Date(now()).toISOString();
  const namespace = env.VERCEL_ENV === 'production' ? 'production' : `preview-${hash(env.VERCEL_GIT_COMMIT_REF || 'development').slice(0, 12)}`;
  const path = `instagram/v1/${namespace}/state.json`;
  const sourceHash = hash(env.INSTAGRAM_FEED_URL || '');

  async function read() {
    const result = await readInstagramBlob(storage, path);
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw error('state_unavailable');
    const state = JSON.parse(await new Response(result.stream).text());
    if (state.version !== 1 || !state.items || typeof state.items !== 'object') throw error('state_invalid');
    return { state, etag: result.blob.etag };
  }

  async function save(record) {
    const result = await storage.put(path, JSON.stringify(record.state), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(8_000),
    });
    if (!result.etag) throw error('state_etag_missing');
    record.etag = result.etag;
  }

  async function graph(resource, { method = 'GET', fields, body, token = env.INSTAGRAM_ACCESS_TOKEN, deadline = Date.now() + 12_000 } = {}) {
    const base = config.loginMode === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
    const url = new URL(`${base}/${config.graphVersion}/${resource}`);
    if (fields) url.searchParams.set('fields', fields);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
        signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - Date.now()))), redirect: 'error',
      });
    } catch { throw error('meta_transport_unknown'); }
    const data = await response.json().catch(() => null);
    // Never propagate provider bodies, request URLs or access tokens.
    if (!response.ok || !data || data.error) {
      const failure = error('meta_request_failed');
      failure.metaStatus = response.status;
      if (Number.isSafeInteger(data?.error?.code)) failure.metaCode = data.error.code;
      throw failure;
    }
    return data;
  }

  function boundState(state) {
    if (state.accountId !== env.INSTAGRAM_USER_ID || state.username !== EXPECTED_USERNAME || state.loginMode !== config.loginMode || state.sourceHash !== sourceHash) throw error('state_account_or_feed_changed');
  }

  async function verifyAccount(token, deadline) {
    const instagram = config.loginMode === 'instagram';
    const account = await graph(instagram ? 'me' : env.INSTAGRAM_USER_ID, { fields: instagram ? 'user_id,username' : 'id,username', token, deadline });
    if (String(instagram ? account.user_id : account.id) !== String(env.INSTAGRAM_USER_ID) || String(account.username).toLowerCase() !== EXPECTED_USERNAME) throw error('wrong_instagram_account');
  }

  function summary(state) {
    const counts = {};
    for (const item of Object.values(state?.items || {})) counts[item.status] = (counts[item.status] || 0) + 1;
    return { initialized: Boolean(state), initializedAt: state?.initializedAt || null, lastCheckedAt: state?.lastCheckedAt || null,
      lastFeedCount: state?.lastFeedCount || 0, counts, active: state?.active ? { id: state.active.id, phase: state.active.phase, startedAt: state.active.startedAt, containerId: state.active.containerId || null, attempts: state.active.attempts || 1 } : null,
      lastResult: state?.lastResult || null };
  }

  const eligible = (state, item) => item.availability === 'in stock' &&
    (!state.items[item.id] || ((['skipped', 'canceled', 'failed', 'pending'].includes(state.items[item.id].status) ||
      (config.includeExistingStock && state.items[item.id].status === 'baseline')) && (state.items[item.id].attempts || 0) < 3));
  const safeFailure = (e) => ({ reason: e?.code || 'provider_failed',
    ...(Number.isSafeInteger(e?.metaStatus) ? { metaStatus: e.metaStatus } : {}),
    ...(Number.isSafeInteger(e?.metaCode) ? { metaCode: e.metaCode } : {}) });

  async function status() { return { ok: true, configuration: config, authorization: await tokens.status(), ...summary((await read())?.state) }; }

  async function dryRun() {
    if (!config.feedConfigured) throw error('feed_not_configured');
    const items = await fetchFeed(env.INSTAGRAM_FEED_URL, fetchImpl); const record = await read();
    if (record) { boundState(record.state); validateFeedChange(items, record.state); }
    const candidates = record ? items.filter((item) => eligible(record.state, item)) : [];
    return { ok: true, dryRun: true, configuration: config, ...summary(record?.state), feedCount: items.length,
      wouldInitializeBaseline: !record, candidateCount: candidates.length,
      nextPost: candidates[0] ? { id: candidates[0].id, imageUrl: candidates[0].image_link, caption: instagramCaption(candidates[0]) } : null };
  }

  function validateFeedChange(items, state) {
    if (state.lastFeedCount >= 4 && items.length < Math.ceil(state.lastFeedCount / 2)) throw error('feed_suspiciously_incomplete');
    if (Object.keys(state.items).length + items.filter((item) => !state.items[item.id]).length > 5000) throw error('state_capacity_reached');
  }

  async function finish(record, status, details = {}) {
    const active = record.state.active;
    record.state.items[active.id] = { status, attempts: active.attempts || 1, updatedAt: timestamp(), ...details };
    record.state.lastResult = { status, id: active.id, at: timestamp(), ...details };
    record.state.active = null;
    await save(record);
    return { ok: status === 'published' || status === 'canceled', status, id: active.id, ...details };
  }

  async function run() {
    if (!config.enabled) return { ok: true, status: 'disabled', published: 0 };
    if (!config.production) throw error('production_required');
    if (!config.tokenConfigured || !config.accountConfigured || !config.feedConfigured || !config.validApi || !config.imagesConfigured) throw error('instagram_not_configured');
    const deadline = Date.now() + 45_000;
    // Keep authorization renewable even while the catalogue source is down.
    const accessToken = await tokens.resolve();
    const runGraph = (resource, args = {}) => graph(resource, { ...args, token: accessToken });
    const items = await fetchFeed(env.INSTAGRAM_FEED_URL, fetchImpl);
    let record = await read();
    if (record) { boundState(record.state); validateFeedChange(items, record.state); }
    await verifyAccount(accessToken, deadline);
    if (!record) {
      record = { state: { version: 1, accountId: env.INSTAGRAM_USER_ID, username: EXPECTED_USERNAME, loginMode: config.loginMode, sourceHash,
        initializedAt: timestamp(), lastCheckedAt: timestamp(), lastFeedCount: items.length, active: null,
        items: Object.fromEntries(items.map((item) => [item.id, { status: 'baseline', updatedAt: timestamp() }])) } };
      try { await save(record); } catch (e) { if (conflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
      return { ok: true, status: 'baseline_initialized', count: items.length, published: 0 };
    }
    if (record.state.active && ['creating', 'publishing', 'unknown'].includes(record.state.active.phase)) {
      const active = record.state.active;
      // A concurrent live invocation may still be working. Never take over it.
      if (now() - Date.parse(active.startedAt) < 90_000) return { ok: true, status: 'busy', id: active.id, published: 0 };
      if (!active.containerId) return await finish(record, 'failed', { reason: 'container_creation_interrupted' });
      const resolved = await runGraph(active.containerId, { fields: 'status_code', deadline });
      if (resolved.status_code === 'PUBLISHED') return await finish(record, 'published', { reconciled: true });
      if (['EXPIRED', 'ERROR'].includes(resolved.status_code)) return await finish(record, 'failed', { reason: 'container_confirmed_unpublished' });
      return { ok: false, status: 'review_required', id: active.id, publicationConfirmed: false };
    }
    let item;
    if (record.state.active) {
      item = items.find((candidate) => candidate.id === record.state.active.id);
      if (!item || item.availability !== 'in stock' || hash(JSON.stringify(item)) !== record.state.active.fingerprint) return await finish(record, 'canceled');
    } else {
      item = items.find((candidate) => eligible(record.state, candidate));
      for (const candidate of items) if (candidate.availability !== 'in stock' && !record.state.items[candidate.id]) record.state.items[candidate.id] = { status: 'skipped', updatedAt: timestamp() };
      record.state.lastCheckedAt = timestamp(); record.state.lastFeedCount = items.length;
      if (!item) {
        try { await save(record); } catch (e) { if (!conflict(e)) throw e; }
        return { ok: true, status: 'no_new_stock', published: 0 };
      }
      if (Date.now() + 20_000 > deadline) return { ok: true, status: 'deferred', published: 0 };
      record.state.active = { id: item.id, attemptId: randomUUID(), attempts: (record.state.items[item.id]?.attempts || 0) + 1,
        phase: 'creating', startedAt: timestamp(), fingerprint: hash(JSON.stringify(item)) };
      try { await save(record); } catch (e) { if (conflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
      let container;
      try { container = await runGraph(`${env.INSTAGRAM_USER_ID}/media`, { method: 'POST', deadline, body: { image_url: signInstagramImageUrl(item.image_link, env, now()), caption: instagramCaption(item) } }); }
      catch (e) {
        // Creating a container is not a public post. A later run may retry at
        // most three times, even if this non-public request timed out.
        return await finish(record, 'failed', safeFailure(e));
      }
      if (!numericId(container.id)) throw error('meta_invalid_container');
      record.state.active.containerId = String(container.id); record.state.active.phase = 'preparing';
      await save(record);
    }
    // The CAS transition below is the only right to publish. Concurrent
    // cron/manual requests cannot share that right, including resumed containers.
    let container = await runGraph(record.state.active.containerId, { fields: 'status_code', deadline });
    const polls = Math.min(8, Math.max(0, options.pollAttempts ?? 8));
    for (let poll = 0; container.status_code === 'IN_PROGRESS' && poll < polls && Date.now() + 16_000 < deadline; poll++) {
      await pause(1500);
      container = await runGraph(record.state.active.containerId, { fields: 'status_code', deadline });
    }
    if (container.status_code === 'PUBLISHED') return await finish(record, 'published', { reconciled: true });
    if (container.status_code === 'IN_PROGRESS') return { ok: true, status: 'preparing', id: item.id, published: 0 };
    if (container.status_code !== 'FINISHED') return await finish(record, 'failed', { reason: 'container_not_ready' });
    if (Date.now() + 15_000 > deadline) return { ok: true, status: 'preparing', id: item.id, published: 0 };
    record.state.active.phase = 'publishing';
    record.state.active.startedAt = timestamp();
    try { await save(record); } catch (e) { if (conflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
    let published;
    try { published = await runGraph(`${env.INSTAGRAM_USER_ID}/media_publish`, { method: 'POST', deadline, body: { creation_id: record.state.active.containerId } }); }
    catch (e) {
      record.state.active.phase = 'unknown'; record.state.lastResult = { status: 'publish_unknown', id: item.id, at: timestamp(), ...safeFailure(e) };
      await save(record); throw e;
    }
    if (!numericId(published.id)) {
      record.state.active.phase = 'unknown'; await save(record); throw error('meta_publish_unknown');
    }
    return await finish(record, 'published', { mediaId: String(published.id), published: 1 });
  }
  return { configuration: () => config, status, dryRun, run };
}
