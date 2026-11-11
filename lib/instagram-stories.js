import { createHash, randomUUID } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { fetchInstagramFeed, instagramConfiguration } from './instagram-publisher.js';
import { createInstagramTokenManager } from './instagram-token.js';
import { instagramVideoAccessConfigured, instagramVideoPath, signInstagramVideoUrl } from './instagram-video-access.js';

const PATH = 'instagram/v1/production/stories.json';
const PUBLICATIONS = 'instagram/v1/production/state.json';
const SCOPES = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_contents', 'pages_read_engagement'];
const MAX_ITEMS = 5000;
const numeric = value => /^\d{5,30}$/.test(String(value || ''));
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const storyFingerprint = item => hash(JSON.stringify(item));

export function createInstagramStories(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const tokens = options.tokenManager || createInstagramTokenManager({ env, storage, fetchImpl, now });
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const render = options.renderVideo || (async (item, settings) => (await import('./instagram-video.js')).renderInstagramVideo(item, settings));
  const facebookId = String(env.INSTAGRAM_RETIREMENTS_USER_ID || '');
  const pageId = String(env.INSTAGRAM_RETIREMENTS_PAGE_ID || '');
  const accountId = String(env.INSTAGRAM_USER_ID || '');
  const version = env.INSTAGRAM_RETIREMENTS_GRAPH_VERSION || 'v27.0';
  const token = env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN;
  const sourceHash = hash(env.INSTAGRAM_FEED_URL || '');
  const config = {
    enabled: env.INSTAGRAM_STORIES_ENABLED === 'true', production: env.VERCEL_ENV === 'production',
    authorizationConfigured: Boolean(token) && numeric(facebookId) && numeric(pageId) && /^v\d{2}\.0$/.test(version) && Number(version.slice(1, -2)) >= 27,
    feedConfigured: instagramConfiguration(env).feedConfigured, videoConfigured: instagramVideoAccessConfigured(env),
    username: 'autovalorpt', maxStoriesPerRun: 1, durationSeconds: 30, width: 1080, height: 1920,
    whatsappStatusAutomatic: false,
  };
  const timestamp = () => new Date(now()).toISOString();
  const budget = (deadline = Infinity, cap = 10000) => {
    const time = Math.min(cap, deadline - Date.now());
    if (time < 1) throw fail('story_budget_exhausted');
    return time;
  };
  const binding = { version: 1, accountId, facebookId, pageId, sourceHash };

  async function readJson(path, deadline) {
    const result = await readInstagramBlob(storage, path, budget(deadline, 8000));
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('story_state_unavailable');
    let state;
    try { state = JSON.parse(await new Response(result.stream).text()); } catch { throw fail('story_state_invalid'); }
    if (!state || state.version !== 1 || !state.items || typeof state.items !== 'object' || Array.isArray(state.items) || Object.keys(state.items).length > MAX_ITEMS) throw fail('story_state_invalid');
    return { state, etag: result.blob.etag };
  }
  async function readLedger(deadline) {
    const record = await readJson(PATH, deadline);
    if (record && Object.entries(binding).some(([key, value]) => record.state[key] !== value)) throw fail('story_binding_changed');
    return record;
  }
  async function save(record, deadline) {
    const result = await storage.put(PATH, JSON.stringify(record.state), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(budget(deadline, 8000)),
    });
    if (!result.etag) throw fail('story_state_unavailable');
    record.etag = result.etag;
  }
  async function snapshot(deadline) {
    if (!config.production) throw fail('production_required');
    if (!config.feedConfigured) throw fail('feed_not_configured');
    const items = await fetchInstagramFeed(env.INSTAGRAM_FEED_URL, fetchImpl, budget(deadline, 12000));
    if (items.some(item => new URL(item.link).pathname.match(/-(ID[A-Za-z0-9]{5,30})\.html?$/)?.[1] !== item.id)) throw fail('story_listing_mismatch');
    const publication = await readJson(PUBLICATIONS, deadline);
    if (!publication || publication.state.accountId !== accountId || publication.state.username !== 'autovalorpt' ||
        publication.state.sourceHash !== sourceHash || publication.state.loginMode !== (env.INSTAGRAM_LOGIN_MODE || 'instagram')) throw fail('story_publication_binding_changed');
    const record = await readLedger(deadline);
    const priorCount = Math.max(publication.state.lastFeedCount || 0, record?.state.lastFeedCount || 0);
    if (priorCount >= 4 && items.length < Math.ceil(priorCount / 2)) throw fail('feed_suspiciously_incomplete');
    if ((record ? Object.keys(record.state.items).length : 0) + items.filter(item => !record?.state.items[item.id]).length > MAX_ITEMS) throw fail('story_state_capacity');
    return { items, publication: publication.state, record };
  }
  async function graph(resource, { method = 'GET', params, body, deadline } = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value);
    let response;
    try {
      response = await fetchImpl(url.href, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}), redirect: 'error', signal: AbortSignal.timeout(budget(deadline, 12000)) });
    } catch { throw fail('story_transport_unknown'); }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.error) {
      const error = fail('story_provider_rejected'); error.metaStatus = response.status;
      if (Number.isSafeInteger(data?.error?.code)) error.metaCode = data.error.code;
      throw error;
    }
    return data;
  }
  async function authorization(deadline) {
    if (!config.authorizationConfigured) return { ready: false, reason: 'facebook_authorization_required', missingPermissions: SCOPES };
    const permissions = await graph('me/permissions', { deadline });
    const granted = new Set((permissions.data || []).filter(entry => entry.status === 'granted').map(entry => entry.permission));
    const missingPermissions = SCOPES.filter(scope => !granted.has(scope));
    if (missingPermissions.length) return { ready: false, reason: 'story_permissions_required', missingPermissions };
    const page = await graph(pageId, { params: { fields: 'id,instagram_business_account{id,username}' }, deadline });
    if (String(page.id) !== pageId || String(page.instagram_business_account?.id) !== facebookId || page.instagram_business_account?.username?.toLowerCase() !== 'autovalorpt') throw fail('wrong_story_account');
    const account = await graph(facebookId, { params: { fields: 'id,username' }, deadline });
    if (String(account.id) !== facebookId || account.username?.toLowerCase() !== 'autovalorpt') throw fail('wrong_story_account');
    // account_type belongs to Instagram Login; Facebook Graph no longer
    // exposes it on IGUser. Resolve the existing encrypted publisher token.
    if ((env.INSTAGRAM_LOGIN_MODE || 'instagram') !== 'instagram') return { ready: false, reason: 'instagram_account_type_verification_required', missingPermissions: [] };
    const instagramVersion = env.INSTAGRAM_GRAPH_VERSION || 'v26.0';
    if (!/^v\d{2}\.0$/.test(instagramVersion)) throw fail('story_instagram_version_invalid');
    const accessToken = await tokens.resolve();
    let response;
    try { response = await fetchImpl(`https://graph.instagram.com/${instagramVersion}/me?fields=user_id,username,account_type`, {
      headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'error', signal: AbortSignal.timeout(budget(deadline, 12000)),
    }); } catch { throw fail('story_account_verification_unavailable'); }
    const profile = await response.json().catch(() => null);
    if (!response.ok || !profile || profile.error) throw fail('story_account_verification_rejected');
    if (String(profile.user_id) !== accountId || profile.username?.toLowerCase() !== 'autovalorpt') throw fail('wrong_story_account');
    const accountType = String(profile.account_type || 'unknown').toUpperCase();
    if (accountType !== 'BUSINESS') return { ready: false, reason: 'instagram_business_account_required', accountType, missingPermissions: [] };
    return { ready: true, accountType: 'BUSINESS', missingPermissions: [] };
  }
  function initialize(items) {
    return { state: { ...binding, initializedAt: timestamp(), lastCheckedAt: timestamp(), lastFeedCount: items.length, active: null, lastResult: null,
      items: Object.fromEntries(items.map(item => [item.id, { status: 'baseline', at: timestamp() }])) }, etag: null };
  }
  function observe(record, items) {
    for (const item of items) {
      if (!record.state.items[item.id]) record.state.items[item.id] = { status: item.availability === 'in stock' ? 'queued' : 'canceled', at: timestamp() };
      const entry = record.state.items[item.id];
      if (entry.status === 'failed' && item.availability === 'in stock' && (entry.attempts || 0) < 3) entry.status = 'queued';
      if (['queued', 'ready', 'preview_ready', 'failed'].includes(entry.status) && item.availability !== 'in stock') entry.status = 'canceled';
      if (['ready', 'preview_ready'].includes(entry.status) && entry.fingerprint !== storyFingerprint(item)) {
        entry.status = entry.status === 'preview_ready' ? 'baseline' : 'queued'; delete entry.videoPath; delete entry.fingerprint;
      }
    }
    record.state.lastCheckedAt = timestamp(); record.state.lastFeedCount = items.length;
  }
  function summary(record) {
    const state = record?.state;
    return { initialized: Boolean(state), initializedAt: state?.initializedAt || null,
      active: state?.active ? { id: state.active.id, phase: state.active.phase, startedAt: state.active.startedAt } : null,
      lastResult: state?.lastResult || null, items: Object.entries(state?.items || {}).map(([id, item]) => ({ id, status: item.status, at: item.at,
        ...(item.mediaId ? { mediaId: item.mediaId } : {}), ...(item.reason ? { reason: item.reason } : {}),
        ...(item.videoPath && item.fingerprint ? { videoUrl: signInstagramVideoUrl(id, item.fingerprint, env, now()) } : {}) })) };
  }
  function testCandidate(items, publication, id) {
    if (!/^ID[A-Za-z0-9]{5,30}$/.test(String(id || ''))) throw fail('story_test_id_invalid');
    const item = items.find(entry => entry.id === id && entry.availability === 'in stock');
    const published = publication.items[id]; const at = Date.parse(published?.updatedAt || '');
    if (!item || published?.status !== 'published' || !numeric(published.mediaId) || !Number.isFinite(at) || now() - at > 48 * 3600_000 || at > now() || publication.lastResult?.id !== id || publication.lastResult?.status !== 'published') throw fail('story_test_requires_latest_publication');
    return item;
  }
  async function finish(record, status, details, deadline) {
    const active = record.state.active;
    record.state.items[active.id] = { ...record.state.items[active.id], status, at: timestamp(), ...details };
    record.state.lastResult = { status, id: active.id, at: timestamp(), ...details };
    record.state.active = null; await save(record, deadline);
    return { ok: ['published', 'canceled', 'preview_ready', 'retired'].includes(status), status, id: active.id, ...details };
  }
  async function status() { return { ok: true, configuration: config, ...summary(config.production ? await readLedger() : null) }; }
  async function dryRun() {
    const data = await snapshot(); const auth = await authorization();
    const plans = data.record ? data.items.filter(item => item.availability === 'in stock' && (!data.record.state.items[item.id] || ['queued', 'ready'].includes(data.record.state.items[item.id].status))).map(item => item.id) : [];
    return { ok: true, dryRun: true, configuration: config, authorization: auth, wouldInitializeBaseline: !data.record, candidates: plans,
      latestPhotoPublication: data.publication.lastResult?.status === 'published' ? { id: data.publication.lastResult.id, at: data.publication.lastResult.at } : null, ...summary(data.record) };
  }
  async function renderAndStore(item, deadline) {
    const fingerprint = storyFingerprint(item); const path = instagramVideoPath(item.id, fingerprint);
    let existing;
    try { existing = await storage.head(path, { abortSignal: AbortSignal.timeout(budget(deadline, 8000)) }); } catch (error) {
      if (!(error?.status === 404 || error?.statusCode === 404 || /NotFound/.test(error?.name || ''))) throw error;
    }
    if (existing) {
      if (existing.contentType !== 'video/mp4' || existing.size < 1000 || existing.size > 30 * 1024 * 1024) throw fail('story_asset_invalid');
      return { fingerprint, videoPath: path, bytes: existing.size };
    }
    const video = await render(item, { fetchImpl, deadline: Math.min(deadline - 45000, Date.now() + 180000) });
    if (!Buffer.isBuffer(video.buffer) || video.buffer.length < 1000 || video.buffer.length > 30 * 1024 * 1024 || video.width !== 1080 || video.height !== 1920 || video.duration !== 30) throw fail('story_render_invalid');
    await storage.put(path, video.buffer, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(budget(deadline, 15000)) });
    return { fingerprint, videoPath: path, bytes: video.buffer.length };
  }
  async function preview(id) {
    if (!config.videoConfigured) throw fail('video_signing_not_configured');
    const deadline = Date.now() + 270000; const data = await snapshot(deadline);
    const item = testCandidate(data.items, data.publication, id); const record = data.record || initialize(data.items);
    if (record.state.active) return { ok: false, status: 'busy', published: 0 };
    if (['published', 'retired', 'unknown'].includes(record.state.items[id]?.status)) throw fail('story_already_processed');
    record.state.items[id] = { ...record.state.items[id], attempts: (record.state.items[id]?.attempts || 0) + 1 };
    record.state.active = { id, mode: 'preview', phase: 'rendering', startedAt: timestamp(), fingerprint: storyFingerprint(item), attemptId: randomUUID() };
    try { await save(record, deadline); } catch (e) { if (instagramStorageConflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
    try {
      const asset = await renderAndStore(item, deadline);
      const fresh = (await snapshot(deadline)).items.find(value => value.id === id);
      if (!fresh || fresh.availability !== 'in stock' || storyFingerprint(fresh) !== asset.fingerprint) return await finish(record, 'canceled', { reason: 'stock_changed_during_render' }, deadline);
      const result = await finish(record, 'preview_ready', asset, deadline);
      return { ...result, videoUrl: signInstagramVideoUrl(id, asset.fingerprint, env, now()), published: 0 };
    } catch (e) { if (record.state.active) await finish(record, 'preview_failed', { reason: e.code || 'story_render_failed' }, deadline); throw e; }
  }
  async function retire(record, items, deadline) {
    for (const [id, entry] of Object.entries(record.state.items)) {
      if (entry.status !== 'published') continue;
      if (now() - Date.parse(entry.at) > 25 * 3600_000) { entry.status = 'expired'; await save(record, deadline); continue; }
      const item = items.find(value => value.id === id);
      if (!item || (item.availability === 'in stock' && storyFingerprint(item) === entry.fingerprint)) continue;
      if (!numeric(entry.mediaId)) throw fail('story_media_id_missing');
      const fresh = (await snapshot(deadline)).items.find(value => value.id === id);
      if (!fresh || (fresh.availability === 'in stock' && storyFingerprint(fresh) === entry.fingerprint)) continue;
      record.state.active = { id, phase: 'deleting', startedAt: timestamp(), mediaId: entry.mediaId };
      await save(record, deadline);
      try {
        const result = await graph(entry.mediaId, { method: 'DELETE', deadline });
        if (result.success !== true || String(result.deleted_id) !== entry.mediaId) throw fail('story_delete_unknown');
      } catch (e) { record.state.active.phase = 'unknown'; record.state.lastResult = { status: 'delete_unknown', id, at: timestamp(), reason: e.code || 'story_delete_unknown' }; await save(record, deadline); throw e; }
      // A failed confirmation write leaves the durable 'deleting' claim intact;
      // do not accidentally turn it into a retryable failure after DELETE.
      await finish(record, 'retired', { reason: fresh.availability === 'in stock' ? 'vehicle_details_changed' : 'vehicle_unavailable' }, deadline);
    }
  }
  async function run({ sampleId } = {}) {
    if (!config.enabled) return { ok: true, status: 'disabled', published: 0 };
    if (!config.videoConfigured) throw fail('video_signing_not_configured');
    const deadline = Date.now() + 270000;
    const data = await snapshot(deadline); const auth = await authorization(deadline);
    if (!auth.ready) return { ok: false, status: 'authorization_required', authorization: auth, published: 0 };
    const record = data.record || initialize(data.items);
    const active = record.state.active;
    if (active) {
      if (['publishing', 'deleting', 'unknown'].includes(active.phase)) return { ok: false, status: 'review_required', id: active.id, published: 0 };
      if (now() - Date.parse(active.startedAt) < 360000) return { ok: true, status: 'busy', id: active.id, published: 0 };
      if (active.phase !== 'preparing') { record.state.active = null; record.state.items[active.id].status = active.mode === 'preview' ? 'preview_failed' : 'queued'; }
    }
    if (!data.record && !sampleId) { await save(record, deadline); return { ok: true, status: 'baseline_initialized', published: 0 }; }
    observe(record, data.items);
    if (sampleId) {
      testCandidate(data.items, data.publication, sampleId);
      if (['published', 'retired', 'expired', 'unknown'].includes(record.state.items[sampleId]?.status)) return { ok: true, status: 'already_processed', published: 0 };
      record.state.items[sampleId] = { ...record.state.items[sampleId], status: record.state.items[sampleId]?.videoPath ? 'ready' : 'queued' };
    }
    // Do not overwrite a previously persisted, resumable container with a
    // deletion claim for another item. Finish that container first.
    if (!record.state.active) await retire(record, data.items, deadline);
    let item = record.state.active ? data.items.find(value => value.id === record.state.active.id) :
      [...data.items].reverse().find(value => value.availability === 'in stock' && ['queued', 'ready'].includes(record.state.items[value.id]?.status));
    if (!item && record.state.active) return await finish(record, 'canceled', { reason: 'stock_entry_missing' }, deadline);
    if (!item) { await save(record, deadline); return { ok: true, status: 'no_new_stock', published: 0 }; }
    if (record.state.active && (item.availability !== 'in stock' || storyFingerprint(item) !== record.state.active.fingerprint)) return await finish(record, 'canceled', { reason: 'stock_changed' }, deadline);
    if (!record.state.active) {
      record.state.items[item.id] = { ...record.state.items[item.id], attempts: (record.state.items[item.id]?.attempts || 0) + 1 };
      record.state.active = { id: item.id, phase: 'rendering', startedAt: timestamp(), fingerprint: storyFingerprint(item), attemptId: randomUUID() };
      try { await save(record, deadline); } catch (e) { if (instagramStorageConflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
      let asset;
      try { asset = await renderAndStore(item, deadline); } catch (e) { await finish(record, 'failed', { reason: e.code || 'story_render_failed' }, deadline); throw e; }
      record.state.items[item.id] = { ...record.state.items[item.id], ...asset, status: 'ready', at: timestamp() };
      const refreshed = (await snapshot(deadline)).items.find(value => value.id === item.id);
      if (!refreshed || refreshed.availability !== 'in stock' || storyFingerprint(refreshed) !== asset.fingerprint) return await finish(record, 'canceled', { reason: 'stock_changed_during_render' }, deadline);
      record.state.active.phase = 'creating'; await save(record, deadline);
      let container;
      try { container = await graph(`${facebookId}/media`, { method: 'POST', body: { media_type: 'STORIES', video_url: signInstagramVideoUrl(item.id, asset.fingerprint, env, now()) }, deadline }); }
      catch (e) { await finish(record, 'failed', { reason: e.code || 'story_container_failed' }, deadline); throw e; }
      if (!numeric(container.id)) return await finish(record, 'failed', { reason: 'story_container_invalid' }, deadline);
      record.state.active.phase = 'preparing'; record.state.active.containerId = String(container.id); await save(record, deadline);
    }
    let container = await graph(record.state.active.containerId, { params: { fields: 'status_code' }, deadline });
    for (let poll = 0; container.status_code === 'IN_PROGRESS' && poll < (options.pollAttempts ?? 10) && Date.now() + 30000 < deadline; poll++) {
      await pause(2000); container = await graph(record.state.active.containerId, { params: { fields: 'status_code' }, deadline });
    }
    if (container.status_code === 'IN_PROGRESS') return { ok: true, status: 'preparing', id: item.id, published: 0 };
    if (container.status_code === 'PUBLISHED') {
      record.state.active.phase = 'unknown'; await save(record, deadline);
      return { ok: false, status: 'review_required', id: item.id, published: 0 };
    }
    if (container.status_code !== 'FINISHED') return await finish(record, 'failed', { reason: 'story_container_not_ready' }, deadline);
    const current = (await snapshot(deadline)).items.find(value => value.id === item.id);
    if (!current || current.availability !== 'in stock' || storyFingerprint(current) !== record.state.active.fingerprint) return await finish(record, 'canceled', { reason: 'stock_changed_before_publication' }, deadline);
    record.state.active.phase = 'publishing'; record.state.active.startedAt = timestamp();
    try { await save(record, deadline); } catch (e) { if (instagramStorageConflict(e)) return { ok: true, status: 'busy', published: 0 }; throw e; }
    let published;
    try {
      published = await graph(`${facebookId}/media_publish`, { method: 'POST', body: { creation_id: record.state.active.containerId }, deadline });
      if (!numeric(published.id)) throw fail('story_publish_unknown');
    } catch (e) { record.state.active.phase = 'unknown'; record.state.lastResult = { status: 'publish_unknown', id: item.id, at: timestamp(), reason: e.code || 'story_publish_unknown' }; await save(record, deadline); throw e; }
    return await finish(record, 'published', { mediaId: String(published.id), published: 1 }, deadline);
  }
  return { configuration: () => config, status, dryRun, preview, run };
}
