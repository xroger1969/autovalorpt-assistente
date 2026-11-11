import { createHash } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { createInstagramPublisher, fetchInstagramFeed, instagramConfiguration } from './instagram-publisher.js';

const EXPECTED_USERNAME = 'autovalorpt';
const STATE_PATH = 'instagram/v1/production/state.json';
const RETIREMENTS_PATH = 'instagram/v1/production/retirements.json';
const numericId = (value) => /^\d{5,30}$/.test(String(value || ''));
const fail = (code) => Object.assign(new Error(code), { code });
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');

function permalink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) &&
      !url.port && !url.username && !url.password && !url.search && !url.hash && /^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
      ? url.pathname.replace(/\/$/, '') : null;
  } catch { return null; }
}

function listingId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['standvirtual.com', 'www.standvirtual.com'].includes(url.hostname) ||
        url.port || url.username || url.password || !url.pathname.includes('/anuncio/')) return null;
    return url.pathname.match(/-(ID[A-Za-z0-9]{5,30})\.html?$/)?.[1] || null;
  } catch { return null; }
}

export function createInstagramRetirements(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const publisher = options.publisher || createInstagramPublisher(options);
  const accountId = String(env.INSTAGRAM_USER_ID || '');
  const facebookId = String(env.INSTAGRAM_RETIREMENTS_USER_ID || '');
  const pageId = String(env.INSTAGRAM_RETIREMENTS_PAGE_ID || '');
  const version = env.INSTAGRAM_RETIREMENTS_GRAPH_VERSION || 'v27.0';
  const token = env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN;
  const sourceHash = hash(env.INSTAGRAM_FEED_URL || '');
  const configuration = {
    enabled: env.INSTAGRAM_RETIREMENTS_ENABLED === 'true',
    production: env.VERCEL_ENV === 'production',
    authorizationConfigured: Boolean(token) && numericId(facebookId) && numericId(pageId) && /^v\d{2}\.0$/.test(version) && Number(version.slice(1, -2)) >= 27,
    feedConfigured: instagramConfiguration(env).feedConfigured,
    username: EXPECTED_USERNAME, maxRetirementsPerRun: 10,
  };
  const timestamp = () => new Date(now()).toISOString();
  const budget = (deadline = Infinity, cap = 8000) => {
    const milliseconds = Math.min(cap, deadline - Date.now());
    if (milliseconds < 1) throw fail('retirement_budget_exhausted');
    return milliseconds;
  };

  async function readJson(path, deadline) {
    const result = await readInstagramBlob(storage, path, budget(deadline));
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('retirement_state_unavailable');
    let state;
    try { state = JSON.parse(await new Response(result.stream).text()); } catch { throw fail('retirement_state_invalid'); }
    if (state.version !== 1 || !state.items || typeof state.items !== 'object' || Array.isArray(state.items)) throw fail('retirement_state_invalid');
    return { state, etag: result.blob.etag };
  }

  async function readLedger(deadline) {
    const record = await readJson(RETIREMENTS_PATH, deadline);
    if (record && (record.state.accountId !== accountId || record.state.facebookId !== facebookId || record.state.pageId !== pageId || record.state.sourceHash !== sourceHash)) throw fail('retirement_binding_changed');
    return record || { state: { version: 1, accountId, facebookId, pageId, sourceHash, items: {} }, etag: null };
  }

  async function save(record) {
    const result = await storage.put(RETIREMENTS_PATH, JSON.stringify(record.state), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(8000),
    });
    if (!result.etag) throw fail('retirement_state_unavailable');
    record.etag = result.etag;
  }

  async function graph(resource, { method = 'GET', params = {}, deadline } = {}) {
    const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    const timeout = budget(deadline);
    try {
      response = await fetchImpl(url.href, { method, headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    } catch { throw fail('retirement_transport_unknown'); }
    let data;
    try { data = await response.json(); } catch { throw fail('retirement_response_unknown'); }
    if (!response.ok || !data || data.error) {
      const error = fail('retirement_provider_rejected');
      error.metaStatus = response.status;
      if (Number.isSafeInteger(data?.error?.code)) error.metaCode = data.error.code;
      throw error;
    }
    return data;
  }

  async function verifyAccount(deadline) {
    const permissions = await graph('me/permissions', { deadline });
    const granted = new Set((permissions.data || []).filter((entry) => entry.status === 'granted').map((entry) => entry.permission));
    if (!['instagram_basic', 'instagram_manage_contents'].every((scope) => granted.has(scope))) throw fail('retirement_permission_required');
    const page = await graph(pageId, { params: { fields: 'id,instagram_business_account{id,username}' }, deadline });
    const linked = page.instagram_business_account;
    if (String(page.id) !== pageId || String(linked?.id) !== facebookId || String(linked?.username).toLowerCase() !== EXPECTED_USERNAME) throw fail('wrong_retirement_account');
    const account = await graph(facebookId, { params: { fields: 'id,username' }, deadline });
    if (String(account.id) !== facebookId || String(account.username).toLowerCase() !== EXPECTED_USERNAME) throw fail('wrong_retirement_account');
  }

  async function ownMedia(deadline) {
    const media = []; const cursors = new Set(); let after;
    for (let page = 0; page < 5; page++) {
      const result = await graph(`${facebookId}/media`, { params: { fields: 'id,caption,permalink', limit: '100', ...(after ? { after } : {}) }, deadline });
      if (!Array.isArray(result.data) || result.data.length > 100) throw fail('retirement_media_invalid');
      media.push(...result.data);
      if (!result.paging?.next) return media;
      after = result.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 2000 || cursors.has(after)) throw fail('retirement_media_incomplete');
      cursors.add(after);
    }
    throw fail('retirement_media_incomplete');
  }

  async function snapshot(deadline) {
    if (!configuration.production) throw fail('production_required');
    if (!configuration.feedConfigured) throw fail('feed_not_configured');
    const items = await fetchInstagramFeed(env.INSTAGRAM_FEED_URL, fetchImpl, budget(deadline, 12000));
    const publication = await readJson(STATE_PATH, deadline);
    if (!publication) throw fail('retirement_publication_state_missing');
    const state = publication.state;
    if (state.accountId !== accountId || state.username !== EXPECTED_USERNAME || state.loginMode !== (env.INSTAGRAM_LOGIN_MODE || 'instagram') || state.sourceHash !== sourceHash) throw fail('retirement_binding_changed');
    if (state.lastFeedCount >= 4 && items.length < Math.ceil(state.lastFeedCount / 2)) throw fail('feed_suspiciously_incomplete');
    const candidates = items.filter((item) => ['out of stock', 'discontinued'].includes(item.availability) && state.items[item.id]?.status === 'published');
    if (candidates.some((item) => listingId(item.link) !== item.id)) throw fail('retirement_listing_mismatch');
    return { candidates, ledger: await readLedger(deadline) };
  }

  async function mapping(item, media, deadline) {
    // Get the permalink through the existing authorized publisher; do not assume
    // media IDs from the two login modes are interchangeable.
    let timer;
    const timeout = budget(deadline, 12000);
    let original;
    try {
      // This is a bounded read of the existing publication. If its token refresh
      // finishes later, no retirement continuation is allowed to issue DELETE.
      original = permalink(await Promise.race([publisher.postLink(item.id), new Promise((_, reject) => {
        timer = setTimeout(() => reject(fail('retirement_budget_exhausted')), timeout);
      })]));
    } finally { clearTimeout(timer); }
    if (!original) return { status: 'review_required', reason: 'published_link_missing' };
    const matches = media.filter((entry) => numericId(entry.id) && permalink(entry.permalink) === original &&
      (String(entry.caption || '').match(/https:\/\/[^\s<>]+/g) || []).some((url) => listingId(url) === item.id));
    if (matches.length !== 1) return { status: 'review_required', reason: matches.length ? 'ambiguous_media_match' : 'media_match_missing' };
    return { status: 'ready', mediaId: String(matches[0].id), permalink: matches[0].permalink };
  }

  async function status() {
    if (!configuration.production || !configuration.authorizationConfigured) return { ok: true, configuration, items: [], lastResult: null };
    const { state } = await readLedger();
    return { ok: true, configuration, items: Object.entries(state.items).map(([id, item]) => ({ id, status: item.status, at: item.at, reason: item.reason || null })), lastResult: state.lastResult || null };
  }

  async function dryRun() {
    if (!configuration.authorizationConfigured) return { ok: true, status: 'authorization_required', configuration, candidates: [] };
    const { candidates, ledger } = await snapshot();
    await verifyAccount();
    const media = await ownMedia();
    const plans = [];
    for (const item of candidates) plans.push({ id: item.id, ...(ledger.state.items[item.id] || await mapping(item, media)) });
    return { ok: true, dryRun: true, configuration, candidates: plans };
  }

  async function runOne(deadline, context) {
    if (!configuration.enabled) return { ok: true, status: 'disabled', retired: 0 };
    if (!configuration.authorizationConfigured) throw fail('retirement_authorization_required');
    const { candidates, ledger } = await snapshot(deadline);
    const remaining = candidates.filter((candidate) => ledger.state.items[candidate.id]?.status !== 'retired').length;
    context.remaining = remaining;
    const unresolved = Object.entries(ledger.state.items).find(([, entry]) => ['deleting', 'unknown'].includes(entry.status));
    if (unresolved) return { ok: false, status: 'review_required', id: unresolved[0], retired: 0, remaining };
    const blocked = candidates.find((item) => ['deleting', 'unknown', 'failed'].includes(ledger.state.items[item.id]?.status));
    const item = candidates.find((candidate) => !ledger.state.items[candidate.id] || ledger.state.items[candidate.id].status === 'review_required');
    if (!item) return { ok: !blocked, status: blocked ? 'review_required' : 'no_retirements', retired: 0, remaining, ...(blocked ? { id: blocked.id } : {}) };
    await verifyAccount(deadline);
    const plan = await mapping(item, await ownMedia(deadline), deadline);
    if (plan.status !== 'ready') return { ok: false, ...plan, id: item.id, retired: 0, remaining };
    // Re-read the feed after provider lookups. A vehicle restored in the interim
    // must never be deleted using the earlier sold snapshot.
    const latest = await snapshot(deadline);
    if (!latest.candidates.some((candidate) => candidate.id === item.id)) return { ok: true, status: 'canceled', id: item.id, retired: 0, remaining: remaining - 1 };
    if (Date.now() + 24_000 > deadline) return { ok: true, status: 'deferred', id: item.id, retired: 0, remaining };
    // Claim from the original ledger version: concurrent attempts cannot share
    // the right to issue DELETE, even if provider discovery took some time.
    ledger.state.items[item.id] = { status: 'deleting', mediaId: plan.mediaId, permalink: plan.permalink, at: timestamp() };
    try { await save(ledger); } catch (error) { if (instagramStorageConflict(error)) return { ok: true, status: 'busy', retired: 0, remaining }; throw error; }
    let outcome;
    try {
      const result = await graph(plan.mediaId, { method: 'DELETE', deadline });
      if (result.success !== true || String(result.deleted_id) !== plan.mediaId) throw fail('retirement_response_unknown');
      outcome = { status: 'retired' };
    } catch (error) {
      outcome = { status: error.code === 'retirement_provider_rejected' ? 'failed' : 'unknown', reason: error.code || 'retirement_response_unknown',
        ...(Number.isSafeInteger(error.metaStatus) ? { metaStatus: error.metaStatus } : {}),
        ...(Number.isSafeInteger(error.metaCode) ? { metaCode: error.metaCode } : {}) };
    }
    ledger.state.items[item.id] = { ...ledger.state.items[item.id], ...outcome, at: timestamp() };
    ledger.state.lastResult = { id: item.id, ...outcome, at: timestamp() };
    await save(ledger);
    return { ok: outcome.status === 'retired', id: item.id, ...outcome, retired: outcome.status === 'retired' ? 1 : 0, remaining: remaining - (outcome.status === 'retired' ? 1 : 0) };
  }

  async function run() {
    if (!configuration.enabled) return { ok: true, status: 'disabled', retired: 0 };
    const deadline = Date.now() + 45_000;
    const results = []; const context = { remaining: null };
    for (let attempt = 0; attempt < configuration.maxRetirementsPerRun; attempt++) {
      let result;
      try { result = await runOne(deadline, context); }
      catch (error) {
        if (error.code === 'retirement_budget_exhausted') return { ok: true, status: 'deferred', retired: results.length, remaining: context.remaining, results };
        if (!results.length) throw error;
        return { ok: false, status: 'partial', retired: results.length, remaining: context.remaining, results,
          reason: /^[a-z_]{3,60}$/.test(error.code || '') ? error.code : 'retirement_failed' };
      }
      context.remaining = result.remaining ?? context.remaining;
      if (result.status !== 'retired') {
        if (!results.length) return result;
        return { ...result, status: result.status === 'no_retirements' ? 'retired' : result.status,
          retired: results.length, results };
      }
      results.push(result);
      if (result.remaining === 0 || Date.now() + 24_000 > deadline) break;
    }
    return { ok: true, status: 'retired', retired: results.length, remaining: context.remaining, results,
      ...(results.length === 1 ? { id: results[0].id } : {}) };
  }

  return { status, dryRun, run };
}
