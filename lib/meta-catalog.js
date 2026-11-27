import { createHash, randomUUID } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob as readPrivateBlob, instagramStorageConflict as conflict } from './instagram-storage.js';
import { createMetaCatalogSource } from './meta-catalog-source.js';
import { validInstagramImageSource } from './instagram-image.js';

export const META_CATALOG_FEED_URL = 'https://docs.google.com/spreadsheets/d/1RENDbmN9Inyd2fr0FQJJmbe1jMpJl4Psevlawc92uVs/export?format=csv&gid=1511112026';
const defaults = { catalogId: '1817371622874450', feedId: '1117326544352704', businessId: '759014320107772' };
const FEED_FIELDS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const numericId = (value) => /^\d{5,30}$/.test(String(value || ''));
const vehicleId = (value) => /^ID[A-Za-z0-9]{5,30}$/.test(String(value || ''));
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const fail = (code) => Object.assign(new Error(code), { code });
const safeCode = (value, fallback = 'meta_catalog_unavailable') => /^[a-z_]{3,70}$/.test(value || '') ? value : fallback;
const count = (value) => value !== null && value !== undefined && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const ids = (values) => Array.isArray(values) ? values.filter(vehicleId).slice(0, 2000) : [];
const RESULT_ID_FIELDS = ['missingIds', 'extraIds', 'priceMismatchIds', 'unavailableIds', 'rejectedIds', 'pendingReviewIds',
  'notPublishedIds', 'priceUnverifiedIds', 'foreignFeedIds', 'imageMismatchIds', 'imageUnverifiedIds', 'imagePendingIds'];
const CHANNEL_ID_FIELDS = new Set(['rejectedIds', 'pendingReviewIds', 'notPublishedIds']);
const DATA_ID_FIELDS = RESULT_ID_FIELDS.filter(key => !CHANNEL_ID_FIELDS.has(key));
const DATA_CHECKED_STATUSES = new Set(['catalog_matches', 'products_pending', 'products_rejected']);
const IMAGE_STATUSES = new Set(['prepared', 'unchanged', 'pending', 'review_required', 'failed']);
const CATALOG_IMAGE_PREFIX = 'https://autovalorpt-assistente.vercel.app/api/stock?integration=catalog-image&id=';
const SNAPSHOT_FEED_PREFIX = 'https://autovalorpt-assistente.vercel.app/api/stock?integration=stock-feed&snapshot=';
const LEGACY_SERVER_FEED_URL = `${SNAPSHOT_FEED_PREFIX}latest`;
export const META_CATALOG_LATEST_FEED_URL = `${LEGACY_SERVER_FEED_URL}&format=xml`;
const MIGRATABLE_FEED_URLS = [META_CATALOG_FEED_URL, LEGACY_SERVER_FEED_URL];
const SCHEDULE_FIELDS = ['interval', 'interval_count', 'hour', 'minute', 'day_of_week', 'day_of_month', 'timezone', 'url', 'username'];
const SCHEDULE_DIAGNOSTIC_FIELDS = new Set(['feed.id', ...['schedule', 'update_schedule']
  .flatMap(key => ['presence', ...SCHEDULE_FIELDS].map(field => `${key}.${field}`))]);

function publicScheduleCheck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const sourceClasses = (input) => Object.fromEntries(['schedule', 'update_schedule']
    .filter(key => ['legacy', 'server', 'absent', 'unknown'].includes(input?.[key])).map(key => [key, input[key]]));
  const check = { mismatches: Array.isArray(value.mismatches) ? [...new Set(value.mismatches.filter(field => SCHEDULE_DIAGNOSTIC_FIELDS.has(field)))] : [],
    sources: sourceClasses(value.sources) };
  if (value.write && typeof value.write === 'object' && !Array.isArray(value.write)) {
    check.write = { acknowledged: typeof value.write.acknowledged === 'boolean' ? value.write.acknowledged : null,
      readbackPresent: value.write.readbackPresent === true,
      feedIdentityMatches: typeof value.write.feedIdentityMatches === 'boolean' ? value.write.feedIdentityMatches : null,
      sources: sourceClasses(value.write.sources) };
  }
  return check;
}

function scheduleSources(value) {
  return Object.fromEntries(['schedule', 'update_schedule'].map(key => [key,
    value[key] == null || (typeof value[key] === 'object' && !Object.keys(value[key]).length) ? 'absent' :
      MIGRATABLE_FEED_URLS.includes(value[key]?.url) ? 'legacy' : value[key]?.url === META_CATALOG_LATEST_FEED_URL ? 'server' : 'unknown']));
}

function validFeedTransport(value, fingerprint) {
  if (value === META_CATALOG_FEED_URL) return true;
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(fingerprint || '') &&
    [`${SNAPSHOT_FEED_PREFIX}${fingerprint}`, `${SNAPSHOT_FEED_PREFIX}${fingerprint}&format=xml`].includes(value);
}

function imageIdentity(value, id) {
  if (typeof value !== 'string') return null;
  const prefix = `${CATALOG_IMAGE_PREFIX}${id}&asset=`;
  if (value.startsWith(prefix) && /^[a-f0-9]{64}$/.test(value.slice(prefix.length))) return value;
  if (!validInstagramImageSource(value)) return null;
  const url = new URL(value);
  // Use the stock audit's OLX resize rule to identify the same photograph.
  // The catalogue asset query, including its hash, must remain exact.
  if (!/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/.test(url.pathname)) return null;
  url.pathname = url.pathname.replace(/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/, '/image');
  return url.href;
}

function publicImageDiagnostics(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2000).filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry) &&
    typeof entry.id === 'string' && vehicleId(entry.id) && IMAGE_STATUSES.has(entry.status)).map(entry => ({ id: entry.id, status: entry.status,
    ...(typeof entry.reason === 'string' && /^[a-z_]{3,70}$/.test(entry.reason) ? { reason: entry.reason } : {}) }));
}

function whatsappReviewStatus(product) {
  const statuses = product.capability_to_review_status;
  if (!Array.isArray(statuses) || statuses.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.key !== 'string' || typeof entry.value !== 'string')) return null;
  const whatsapp = statuses.filter((entry) => entry.key === 'WHATSAPP');
  if (whatsapp.length !== 1 || !['APPROVED', 'REJECTED'].includes(whatsapp[0].value)) return null;
  return whatsapp[0].value;
}

function publicAuthorization(value = {}) {
  return { ready: value.ready === true, catalogManagementGranted: typeof value.catalogManagementGranted === 'boolean' ? value.catalogManagementGranted : null,
    source: ['dedicated', 'existing_facebook', 'existing_facebook_probe'].includes(value.source) ? value.source : 'none',
    ...(value.reason ? { reason: safeCode(value.reason) } : {}) };
}

function publicUpload(value) {
  if (!value || !numericId(value.id)) return null;
  return { id: String(value.id), startedAt: date(value.startedAt), completedAt: date(value.completedAt),
    status: ['processing', 'completed', 'completed_with_errors', 'unverified'].includes(value.status) ? value.status : 'unverified',
    errorCount: count(value.errorCount), invalidCount: count(value.invalidCount), persistedCount: count(value.persistedCount), deletedCount: count(value.deletedCount) };
}

function publicResult(value = {}) {
  const result = { ok: value.ok === true, status: safeCode(value.status, 'not_checked'), checkedAt: date(value.checkedAt),
    authorization: publicAuthorization(value.authorization), permissionRequired: value.permissionRequired === true,
    catalogValidated: value.catalogValidated === true, sourceValid: value.sourceValid === true,
    imagesVerified: value.imagesVerified === true, imageDiagnostics: publicImageDiagnostics(value.imageDiagnostics),
    sourceCount: count(value.sourceCount), expectedCount: count(value.expectedCount), actualCount: count(value.actualCount), feedProductCount: count(value.feedProductCount),
    ...(value.selectionEmpty === true ? { selectionEmpty: true } : {}), whatsappVisibilityVerified: false };
  if (typeof value.feedScheduleVerified === 'boolean') result.feedScheduleVerified = value.feedScheduleVerified;
  const scheduleCheck = publicScheduleCheck(value.feedScheduleCheck);
  if (scheduleCheck) result.feedScheduleCheck = scheduleCheck;
  for (const key of RESULT_ID_FIELDS) result[key] = ids(value[key]);
  if (typeof value.imageRevision === 'string' && /^[a-f0-9]{64}$/.test(value.imageRevision)) result.imageRevision = value.imageRevision;
  if (typeof value.additionalImageRevision === 'string' && /^[a-f0-9]{64}$/.test(value.additionalImageRevision)) result.additionalImageRevision = value.additionalImageRevision;
  if (value.reason) result.reason = safeCode(value.reason);
  if (Number.isSafeInteger(value.metaStatus)) result.metaStatus = value.metaStatus;
  if (Number.isSafeInteger(value.metaCode)) result.metaCode = value.metaCode;
  if (value.import) result.import = { latest: publicUpload(value.import.latest), pending: value.import.pending === true,
    unverified: value.import.unverified === true,
    ...(numericId(value.import.requestedId) ? { requestedId: String(value.import.requestedId) } : {}) };
  // Complete stored evidence can confirm the feed's data even if Meta still
  // reports a channel review or publication issue. Older diagnostics without
  // both image revisions or complete comparison fields cannot do so.
  result.catalogDataConfirmed = DATA_CHECKED_STATUSES.has(result.status) && result.ok &&
    result.catalogValidated && result.sourceValid && result.imagesVerified && result.authorization.ready &&
    Boolean(result.checkedAt && result.imageRevision && result.additionalImageRevision) &&
    Number.isSafeInteger(value.expectedCount) && (value.expectedCount > 0 || value.selectionEmpty === true) && value.expectedCount === value.feedProductCount &&
    value.import?.pending === false && value.import.unverified === false &&
    DATA_ID_FIELDS.every(key => Array.isArray(value[key]) && value[key].length === 0);
  result.catalogConfirmed = result.status === 'catalog_matches' && result.catalogValidated && result.sourceValid && result.imagesVerified &&
    result.authorization.ready && !result.import?.pending && !result.import?.unverified &&
    RESULT_ID_FIELDS.every((key) => result[key].length === 0);
  return result;
}

// Graph may return a localized formatted EUR string. Bare integer responses are
// ambiguous (major/minor units), so they cannot justify a price correction.
function euroCents(value, currency, expected = false) {
  let text = String(value ?? '').trim();
  const hasUnit = /EUR|€/i.test(text);
  if ((!hasUnit && currency !== 'EUR') || (currency && currency !== 'EUR')) return null;
  text = text.replace(/EUR|€/gi, '').replace(/[\s\u00a0\u202f]/g, '');
  if (!/^\d+(?:[.,]\d+)*$/.test(text)) return null;
  const decimal = text.match(/[.,](\d{2})$/);
  if (!decimal && !hasUnit && !expected) return null;
  const amount = decimal ? `${text.slice(0, -3).replace(/[.,]/g, '')}.${decimal[1]}` : text.replace(/[.,]/g, '');
  const cents = Math.round(Number(amount) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

export function createMetaCatalog(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const storage = options.storage || { get, head, put };
  const now = options.now || Date.now;
  const runtimeNow = options.runtimeNow || Date.now;
  const auditSource = options.auditSource || createMetaCatalogSource({ ...options, fetchImpl, now }).audit;
  const catalogId = String(env.META_CATALOG_ID || defaults.catalogId);
  const feedId = String(env.META_CATALOG_FEED_ID || defaults.feedId);
  const businessId = String(env.META_CATALOG_BUSINESS_ID || defaults.businessId);
  const version = env.META_CATALOG_GRAPH_VERSION || 'v27.0';
  const namespace = env.VERCEL_ENV === 'production' ? 'production' : `preview-${hash(env.VERCEL_GIT_COMMIT_REF || 'development').slice(0, 12)}`;
  const path = `meta-catalog/v1/${namespace}/state.json`;
  const binding = hash(JSON.stringify({ catalogId, feedId, businessId, url: META_CATALOG_FEED_URL }));
  const configuration = { enabled: env.META_CATALOG_SYNC_ENABLED === 'true', production: env.VERCEL_ENV === 'production',
    tokenConfigured: Boolean(env.META_CATALOG_ACCESS_TOKEN), authorizationProbeEnabled: env.META_CATALOG_AUTHORIZATION_PROBE_ENABLED === 'true',
    useExistingFacebookToken: env.META_CATALOG_USE_EXISTING_FACEBOOK_TOKEN === 'true',
    existingFacebookTokenConfigured: Boolean(env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN), catalogId, feedId, businessId,
    // These are the exact assets approved by the owner during setup. The
    // business ID is pinned context, not a claim of fresh Graph ownership proof.
    valid: catalogId === defaults.catalogId && feedId === defaults.feedId && businessId === defaults.businessId && /^v\d{2}\.0$/.test(version) };
  const timestamp = () => new Date(now()).toISOString();
  const budget = (deadline, cap = 12000) => {
    const remaining = deadline - runtimeNow();
    if (remaining <= 0) throw fail('meta_catalog_deadline_exceeded');
    return Math.min(cap, remaining);
  };

  async function read() {
    const response = await readPrivateBlob(storage, path);
    if (!response) return { state: { version: 1, binding, active: null, lastResult: null, lastValidSource: null }, etag: null };
    if (response.statusCode !== 200 || !response.blob?.etag) throw fail('meta_catalog_state_unavailable');
    let state;
    try { state = JSON.parse(await new Response(response.stream).text()); } catch { throw fail('meta_catalog_state_invalid'); }
    if (state?.version !== 1 || state.binding !== binding || (state.active &&
        (!['requesting', 'submitted', 'unknown'].includes(state.active.phase) ||
          !validFeedTransport(state.active.feedUrl === undefined ? META_CATALOG_FEED_URL : state.active.feedUrl, state.active.fingerprint)))) throw fail('meta_catalog_state_invalid');
    return { state, etag: response.blob.etag };
  }

  async function save(record) {
    const response = await storage.put(path, JSON.stringify(record.state), { access: 'private', addRandomSuffix: false,
      allowOverwrite: Boolean(record.etag), ...(record.etag ? { ifMatch: record.etag } : {}),
      contentType: 'application/json', cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000) });
    if (!response.etag) throw fail('meta_catalog_state_unavailable');
    record.etag = response.etag;
  }

  async function graph(resource, token, { method = 'GET', fields, after, limit, body, deadline } = {}) {
    if (!configuration.valid || !/^(?:me\/permissions|\d{5,30}(?:\/(?:product_feeds|products|uploads))?)$/.test(resource)) throw fail('meta_catalog_configuration_invalid');
    const url = new URL(`https://graph.facebook.com/${version}/${resource}`);
    if (fields) url.searchParams.set('fields', fields);
    if (after) url.searchParams.set('after', after);
    if (limit) url.searchParams.set('limit', String(limit));
    const timeout = budget(deadline);
    let response;
    try { response = await fetchImpl(url.href, { method, headers: { Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}), redirect: 'error', signal: AbortSignal.timeout(timeout) }); }
    catch { throw fail('meta_catalog_transport_unknown'); }
    // Never propagate Graph response bodies, URLs, credential values or error messages.
    let data;
    try {
      if (!response.body || Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error();
      const reader = response.body.getReader(); const chunks = []; let bytes = 0;
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
        if (bytes > 2 * 1024 * 1024) throw new Error(); chunks.push(chunk.value); } }
      finally { await reader.cancel().catch(() => {}); }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw fail('meta_catalog_response_unknown'); }
    if (!response.ok || !data || data.error || data.success === false) {
      const error = fail('meta_catalog_provider_rejected'); error.metaStatus = response.status;
      if (Number.isSafeInteger(data?.error?.code)) error.metaCode = data.error.code;
      if (data?.success === false) error.metaSuccess = false;
      throw error;
    }
    return data;
  }

  async function authorization(deadline) {
    if (env.META_CATALOG_ACCESS_TOKEN) return { token: env.META_CATALOG_ACCESS_TOKEN, summary: { ready: true, source: 'dedicated', catalogManagementGranted: null } };
    const existing = env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN;
    if (!existing || (!configuration.authorizationProbeEnabled && !configuration.useExistingFacebookToken)) return { token: null,
      summary: { ready: false, source: 'none', reason: 'catalog_authorization_required', catalogManagementGranted: null } };
    const permissions = await graph('me/permissions', existing, { deadline });
    if (!Array.isArray(permissions.data) || permissions.paging?.next) throw fail('meta_catalog_permissions_incomplete');
    const granted = permissions.data.some((entry) => entry.permission === 'catalog_management' && entry.status === 'granted');
    const ready = granted && configuration.useExistingFacebookToken;
    return { token: ready ? existing : null, summary: { ready, source: ready ? 'existing_facebook' : 'existing_facebook_probe', catalogManagementGranted: granted,
      ...(!ready ? { reason: granted ? 'catalog_existing_token_not_enabled' : 'catalog_permission_required' } : {}) } };
  }

  async function paged(resource, token, fields, deadline, maxPages = 20) {
    const values = []; const cursors = new Set(); let after;
    for (let page = 0; page < maxPages; page++) {
      const data = await graph(resource, token, { fields, after, limit: 100, deadline });
      if (!Array.isArray(data.data) || data.data.length > 100) throw fail('meta_catalog_listing_invalid');
      values.push(...data.data);
      if (!data.paging?.next) return values;
      after = data.paging?.cursors?.after;
      if (typeof after !== 'string' || !after || after.length > 2000 || cursors.has(after)) throw fail('meta_catalog_listing_incomplete');
      cursors.add(after);
    }
    throw fail('meta_catalog_listing_incomplete');
  }

  function normalizedUpload(upload) {
    if (!numericId(upload?.id)) throw fail('meta_catalog_upload_invalid');
    const startedAt = date(upload.start_time); const completedAt = date(upload.end_time);
    const errorCount = count(upload.error_count); const invalidCount = count(upload.num_invalid_items);
    return { id: String(upload.id), startedAt, completedAt,
      status: completedAt ? ((errorCount || invalidCount) ? 'completed_with_errors' : errorCount !== null && invalidCount !== null ? 'completed' : 'unverified') : (startedAt ? 'processing' : 'unverified'),
      errorCount, invalidCount, persistedCount: count(upload.num_persisted_items), deletedCount: count(upload.num_deleted_items),
      // This is compared with a recorded intent, never accepted as a new URL.
      feedUrl: typeof upload.url === 'string' ? upload.url : null };
  }

  async function snapshot(token, deadline) {
    // Request only catalogue fields available to catalog_management. Reading
    // Business objects requires unrelated access; the approved binding is pinned
    // above, while live catalogue/feed identities are still checked below.
    const catalog = await graph(catalogId, token, { fields: 'id,name', deadline });
    if (String(catalog.id) !== catalogId || ['business', 'owner_business'].some((key) =>
      Object.hasOwn(catalog, key) && String(catalog[key]?.id ?? catalog[key] ?? '') !== businessId)) throw fail('meta_catalog_destination_mismatch');
    const feeds = await paged(`${catalogId}/product_feeds`, token, 'id,name', deadline, 10);
    if (feeds.filter((feed) => String(feed.id) === feedId).length !== 1) throw fail('meta_catalog_feed_mismatch');
    const products = await paged(`${catalogId}/products`, token, 'id,retailer_id,availability,price,currency,capability_to_review_status,visibility,product_feed{id},image_url,additional_image_urls,image_fetch_status', deadline);
    const uploadsResponse = await graph(`${feedId}/uploads`, token, { fields: 'id,start_time,end_time,error_count,num_invalid_items,num_persisted_items,num_deleted_items,url', limit: 25, deadline });
    if (!Array.isArray(uploadsResponse.data) || uploadsResponse.data.length > 25) throw fail('meta_catalog_upload_invalid');
    const uploads = uploadsResponse.data.map(normalizedUpload).sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
    return { products, uploads };
  }

  // ProductFeed.api_update accepts JSON strings for schedule/update_schedule.
  // Preserve the existing cadence; migrate only our known Google/CSV URLs.
  // Unknown fields or credentials require review instead of a partial rewrite.
  function safeSchedule(value) {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw fail('meta_catalog_schedule_invalid');
    if (!Object.keys(value).length) return null;
    const allowed = ['id', ...SCHEDULE_FIELDS];
    if (Object.keys(value).some(key => !allowed.includes(key)) ||
        ![...MIGRATABLE_FEED_URLS, META_CATALOG_LATEST_FEED_URL].includes(value.url) ||
        !['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'].includes(value.interval) ||
        (value.username !== undefined && value.username !== '') ||
        (value.id !== undefined && !numericId(value.id))) throw fail('meta_catalog_schedule_invalid');
    const limits = { interval_count: [1, 366], hour: [0, 23], minute: [0, 59], day_of_month: [1, 31] };
    for (const [key, [min, max]] of Object.entries(limits)) {
      if (value[key] !== undefined && (!Number.isSafeInteger(value[key]) || value[key] < min || value[key] > max)) throw fail('meta_catalog_schedule_invalid');
    }
    if (value.day_of_week !== undefined && !['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].includes(value.day_of_week)) throw fail('meta_catalog_schedule_invalid');
    if (value.timezone !== undefined) {
      if (typeof value.timezone !== 'string' || value.timezone.length > 80) throw fail('meta_catalog_schedule_invalid');
      try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); } catch { throw fail('meta_catalog_schedule_invalid'); }
    }
    const { id: _id, ...schedule } = value;
    return schedule;
  }

  async function migrateSchedule(token, deadline) {
    const fields = 'id,schedule,update_schedule';
    const current = await graph(feedId, token, { fields, deadline });
    if (String(current.id) !== feedId) throw fail('meta_catalog_feed_mismatch');
    const before = Object.fromEntries(['schedule', 'update_schedule'].map(key => [key, safeSchedule(current[key])]));
    const changes = Object.fromEntries(Object.entries(before).filter(([, value]) => MIGRATABLE_FEED_URLS.includes(value?.url))
      .map(([key, value]) => [key, { ...value, url: META_CATALOG_LATEST_FEED_URL }]));
    if (!Object.keys(changes).length) return;
    // Ask the update for its normal acknowledgement. Read the complete schedule
    // in a separate GET; a write response must never stand in for confirmation.
    const check = { mismatches: [], sources: {}, write: { acknowledged: null, readbackPresent: false, feedIdentityMatches: null, sources: {} } };
    let after; let writePending = true;
    try {
      const written = await graph(feedId, token, { method: 'POST',
        body: Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, JSON.stringify(value)])), deadline });
      writePending = false;
      check.write = { acknowledged: typeof written.success === 'boolean' ? written.success : null,
        readbackPresent: ['schedule', 'update_schedule'].some(key => Object.hasOwn(written, key)),
        feedIdentityMatches: Object.hasOwn(written, 'id') ? String(written.id) === feedId : null, sources: scheduleSources(written) };
      after = await graph(feedId, token, { fields, deadline });
    } catch (error) {
      if (writePending && error.metaSuccess === false) check.write.acknowledged = false;
      throw Object.assign(error, { feedScheduleCheck: check });
    }
    // Persist only booleans, field names and known URL classifications. Never
    // persist Graph objects, URLs, cadence values or authentication data.
    check.sources = scheduleSources(after);
    if (String(after.id) !== feedId) {
      check.mismatches.push('feed.id');
      throw Object.assign(fail('meta_catalog_schedule_unconfirmed'), { feedScheduleCheck: check });
    }
    for (const key of ['schedule', 'update_schedule']) {
      let actual;
      try { actual = safeSchedule(after[key]); }
      catch (error) { throw Object.assign(error, { feedScheduleCheck: check }); }
      const expected = changes[key] || before[key];
      if (expected === null ? actual !== null : !actual) check.mismatches.push(`${key}.presence`);
      else if (expected) for (const [field, value] of Object.entries(expected)) {
        if (actual[field] !== value) check.mismatches.push(`${key}.${field}`);
      }
    }
    if (check.mismatches.length) throw Object.assign(fail('meta_catalog_schedule_unconfirmed'), { feedScheduleCheck: check });
    return check;
  }

  async function source(record) {
    const previous = record.state.lastValidSource;
    const audit = await auditSource({ previousExpectedIds: ids(previous?.ids), previousExpectedCount: count(previous?.count) });
    const counts = { sourceCount: count(audit?.sourceCount), expectedCount: count(audit?.expectedCount),
      imageDiagnostics: publicImageDiagnostics(audit?.imageDiagnostics) };
    if (audit?.valid !== true) return { ...counts, valid: false, reason: safeCode(audit?.reason, 'source_audit_failed') };
    if (!Array.isArray(audit.items) || (audit.items.length === 0 && audit.selectionEmpty !== true) || audit.items.length > 2000 || count(audit.expectedCount) !== audit.items.length) return { ...counts, valid: false, reason: 'source_audit_invalid' };
    const seen = new Set();
    for (const item of audit.items) {
      if (!vehicleId(item.id) || seen.has(item.id) || euroCents(item.price, 'EUR', true) === null || !['in stock', 'in_stock'].includes(item.availability || 'in stock')) return { ...counts, valid: false, reason: 'source_audit_invalid' };
      seen.add(item.id);
    }
    let expectedImages; let imageRevision; let expectedAdditionalImages; let additionalImageRevision;
    if (audit.expectedImages !== undefined) {
      const images = audit.expectedImages;
      if (!images || typeof images !== 'object' || Array.isArray(images) || Object.keys(images).length !== audit.items.length ||
          audit.items.some(item => !Object.hasOwn(images, item.id) || images[item.id] !== item.image_link || !imageIdentity(images[item.id], item.id)))
        return { ...counts, valid: false, reason: 'source_images_invalid' };
      expectedImages = Object.fromEntries(audit.items.map(item => [item.id, images[item.id]]));
      imageRevision = hash(JSON.stringify(Object.entries(expectedImages).sort(([a], [b]) => a.localeCompare(b))));
      if (audit.imageRevision !== undefined && audit.imageRevision !== imageRevision)
        return { ...counts, valid: false, reason: 'source_images_invalid' };
    }
    if (audit.expectedAdditionalImages !== undefined) {
      const galleries = audit.expectedAdditionalImages;
      if (!galleries || typeof galleries !== 'object' || Array.isArray(galleries) || Object.keys(galleries).length !== audit.items.length)
        return { ...counts, valid: false, reason: 'source_images_invalid' };
      for (const item of audit.items) {
        const gallery = galleries[item.id];
        const field = item.additional_image_link;
        if (!Object.hasOwn(galleries, item.id) || !Array.isArray(gallery) || gallery.length > 20 ||
            field !== undefined && typeof field !== 'string') return { ...counts, valid: false, reason: 'source_images_invalid' };
        const expected = field ? field.split(',').map(value => value.trim()) : [];
        const canonical = gallery.map(value => validInstagramImageSource(value) ? imageIdentity(value, item.id) : null);
        if (canonical.includes(null) || new Set(canonical).size !== canonical.length || canonical.includes(imageIdentity(item.image_link, item.id)) ||
            JSON.stringify(gallery) !== JSON.stringify(expected)) return { ...counts, valid: false, reason: 'source_images_invalid' };
      }
      expectedAdditionalImages = Object.fromEntries(audit.items.map(item => [item.id, [...galleries[item.id]]]));
      additionalImageRevision = hash(JSON.stringify(Object.entries(expectedAdditionalImages).sort(([a], [b]) => a.localeCompare(b))));
      if (audit.additionalImageRevision !== undefined && audit.additionalImageRevision !== additionalImageRevision)
        return { ...counts, valid: false, reason: 'source_images_invalid' };
    } else if (audit.items.some(item => Object.hasOwn(item, 'additional_image_link'))) {
      // A gallery-bearing source must supply its complete, verified map. Never
      // silently confirm just the cover of a newly extended feed.
      return { ...counts, valid: false, reason: 'source_images_invalid' };
    }
    const feedFields = expectedAdditionalImages ? [...FEED_FIELDS, 'additional_image_link'] : FEED_FIELDS;
    const fingerprint = /^[a-f0-9]{64}$/.test(audit.feedHash || '') ? audit.feedHash :
      hash(JSON.stringify(audit.items.map((item) => feedFields.map((field) => item[field] ?? '')).sort((a, b) => a[0].localeCompare(b[0]))));
    const feedUrl = audit.feedUrl === undefined ? META_CATALOG_FEED_URL : audit.feedUrl;
    if (!validFeedTransport(feedUrl, fingerprint)) return { ...counts, valid: false, reason: 'source_feed_url_invalid' };
    return { ...counts, ...(audit.selectionEmpty === true ? { selectionEmpty: true } : {}), valid: true, items: audit.items, expectedCount: audit.items.length, fingerprint, feedUrl,
      ...(expectedImages ? { expectedImages, imageRevision } : {}),
      ...(expectedAdditionalImages ? { expectedAdditionalImages, additionalImageRevision } : {}) };
  }

  function compare(audit, remote) {
    const all = new Map();
    for (const product of remote.products) {
      const id = String(product.retailer_id || '');
      if (!id || all.has(id)) throw fail('meta_catalog_duplicate_or_invalid_product');
      all.set(id, product);
    }
    const expected = new Set(audit.items.map((item) => item.id));
    const own = remote.products.filter((item) => String(item.product_feed?.id || item.product_feed || '') === feedId);
    const report = { actualCount: remote.products.length, feedProductCount: own.length, missingIds: [], extraIds: own.filter((p) => !expected.has(p.retailer_id)).map((p) => p.retailer_id),
      priceMismatchIds: [], unavailableIds: [], rejectedIds: [], pendingReviewIds: [], notPublishedIds: [], priceUnverifiedIds: [], foreignFeedIds: [],
      imageMismatchIds: [], imageUnverifiedIds: [], imagePendingIds: [] };
    for (const item of audit.items) {
      const actual = all.get(item.id);
      if (!actual) { report.missingIds.push(item.id); continue; }
      if (String(actual.product_feed?.id || actual.product_feed || '') !== feedId) report.foreignFeedIds.push(item.id);
      const price = euroCents(actual.price, actual.currency);
      if (price === null) report.priceUnverifiedIds.push(item.id);
      else if (price !== euroCents(item.price, 'EUR', true)) report.priceMismatchIds.push(item.id);
      if (!['in stock', 'in_stock'].includes(actual.availability)) report.unavailableIds.push(item.id);
      const reviewStatus = whatsappReviewStatus(actual);
      if (reviewStatus === 'REJECTED') report.rejectedIds.push(item.id);
      if (!reviewStatus) report.pendingReviewIds.push(item.id);
      if (actual.visibility !== 'published') report.notPublishedIds.push(item.id);
      if (audit.expectedImages) {
        if (typeof actual.image_url !== 'string' || !actual.image_url.trim()) report.imageUnverifiedIds.push(item.id);
        else if (imageIdentity(actual.image_url, item.id) !== imageIdentity(audit.expectedImages[item.id], item.id)) report.imageMismatchIds.push(item.id);
        else if (actual.image_fetch_status !== 'FETCHED') report.imagePendingIds.push(item.id);
      }
      if (audit.expectedAdditionalImages) {
        // Graph can omit an empty field even when explicitly requested above.
        // Treat that as zero images: a non-empty expected gallery still differs
        // and cannot be confirmed until Graph returns its actual ordered list.
        const gallery = Object.hasOwn(actual, 'additional_image_urls') ? actual.additional_image_urls : [];
        if (!Array.isArray(gallery) || gallery.some(value => typeof value !== 'string' || !imageIdentity(value, item.id))) {
          if (!report.imageUnverifiedIds.includes(item.id)) report.imageUnverifiedIds.push(item.id);
        } else {
          const expectedGallery = audit.expectedAdditionalImages[item.id].map(value => imageIdentity(value, item.id));
          if (JSON.stringify(gallery.map(value => imageIdentity(value, item.id))) !== JSON.stringify(expectedGallery)) {
            if (!report.imageMismatchIds.includes(item.id)) report.imageMismatchIds.push(item.id);
          } else if (actual.image_fetch_status !== 'FETCHED' && !report.imagePendingIds.includes(item.id)) report.imagePendingIds.push(item.id);
        }
      }
    }
    // This marker is set only by a fresh comparison. Legacy saved reports must
    // not gain image confirmation just because their new diagnostic arrays are empty.
    report.imagesVerified = !(audit.expectedImages || audit.expectedAdditionalImages) || ['missingIds', 'imageMismatchIds', 'imageUnverifiedIds', 'imagePendingIds']
      .every(key => report[key].length === 0);
    return report;
  }

  function reconcile(record, remote, report, audit) {
    const active = record.state.active;
    if (!active) return;
    if (!active.uploadId) {
      // An hourly Meta import can share the same URL and time window. It is not
      // proof of which request succeeded. Only a complete matching snapshot can
      // resolve the desired outcome, without attributing an upload identifier.
      const matches = report.imagesVerified && RESULT_ID_FIELDS.every((key) => report[key].length === 0);
      if (matches && active.fingerprint === audit.fingerprint && !report.import.pending && !report.import.unverified) {
        record.state.lastCompletedHash = active.fingerprint;
        record.state.lastReconciliation = { method: 'catalog_snapshot', at: timestamp() };
        record.state.active = null;
      }
      return;
    }
    const feedUrl = active.feedUrl === undefined ? META_CATALOG_FEED_URL : active.feedUrl;
    const candidates = remote.uploads.filter((upload) => upload.id === active.uploadId && upload.feedUrl === feedUrl);
    if (candidates.length !== 1) return;
    active.uploadId = candidates[0].id; active.phase = 'submitted';
    if (candidates[0].completedAt) {
      record.state.lastCompletedHash = active.fingerprint;
      record.state.lastCompletedUpload = publicUpload(candidates[0]);
      record.state.active = null;
    }
  }

  async function finish(record, report) {
    const safe = publicResult(report); record.state.lastResult = safe;
    try { await save(record); }
    catch (error) { if (conflict(error)) return publicResult({ ...safe, ok: true, status: 'busy', reason: 'concurrent_catalog_check' }); throw fail('meta_catalog_state_unavailable'); }
    return safe;
  }

  async function inspect(performImport) {
    const deadline = runtimeNow() + (Number.isSafeInteger(options.runBudgetMs) && options.runBudgetMs > 0
      ? Math.min(180000, options.runBudgetMs) : 180000);
    const record = await read();
    let report = { checkedAt: timestamp(), status: 'checking', whatsappVisibilityVerified: false };
    try {
      if (!configuration.valid) throw fail('meta_catalog_configuration_invalid');
      // Source audits perform their own I/O before the first Graph request.
      // Keep the remaining time for persisting a fresh deferred result.
      if (deadline - runtimeNow() < 30_000) return await finish(record, {
        ...report, status: 'check_deferred', reason: 'meta_catalog_budget_exhausted' });
      const audit = await source(record);
      report = { ...report, ...(audit.selectionEmpty === true ? { selectionEmpty: true } : {}), sourceValid: audit.valid, sourceCount: audit.sourceCount, expectedCount: audit.expectedCount,
        imageDiagnostics: audit.imageDiagnostics, imageRevision: audit.imageRevision, additionalImageRevision: audit.additionalImageRevision };
      if (!audit.valid) return await finish(record, { ...report, status: 'source_invalid', reason: audit.reason });
      record.state.lastValidSource = { ids: audit.items.map((item) => item.id), count: audit.expectedCount,
        fingerprint: audit.fingerprint, feedUrl: audit.feedUrl, checkedAt: timestamp() };
      const auth = await authorization(deadline); report.authorization = auth.summary;
      if (!auth.token) return await finish(record, { ...report, status: 'authorization_required', permissionRequired: true, reason: auth.summary.reason });
      const remote = await snapshot(auth.token, deadline); report.catalogValidated = true;
      const latestUpload = remote.uploads[0] || null;
      const recentPending = latestUpload?.status === 'processing' && Date.parse(latestUpload.startedAt) >= now() - 30 * 60_000;
      report = { ...report, ...compare(audit, remote), import: { latest: latestUpload, pending: Boolean(recentPending),
        unverified: Boolean(latestUpload && (latestUpload.status === 'unverified' || (latestUpload.status === 'processing' && !recentPending))) } };
      reconcile(record, remote, report, audit);
      const different = ['missingIds', 'extraIds', 'priceMismatchIds', 'unavailableIds', 'imageMismatchIds'].some((key) => report[key].length);
      if (record.state.active) return await finish(record, { ...report, ok: true, status: record.state.active.phase === 'submitted' ? 'import_pending' : 'import_unknown', reason: 'inspect_upload_before_retry' });
      if (report.import.pending) return await finish(record, { ...report, ok: true, status: 'import_pending' });
      if (report.import.unverified) return await finish(record, { ...report, status: 'review_required', reason: 'upload_completion_unverified' });
      if (report.foreignFeedIds.length || report.priceUnverifiedIds.length) return await finish(record, { ...report, status: 'review_required', reason: report.foreignFeedIds.length ? 'product_feed_unverified' : 'product_price_unverified' });
      if (report.imageUnverifiedIds.length) return await finish(record, { ...report, status: 'review_required', reason: 'product_image_unverified' });
      if (performImport && configuration.enabled && configuration.production && audit.feedUrl !== META_CATALOG_FEED_URL) {
        report.feedScheduleCheck = await migrateSchedule(auth.token, deadline); report.feedScheduleVerified = true;
      }
      if (!different) return await finish(record, { ...report, ok: true,
        status: report.rejectedIds.length ? 'products_rejected' : report.imagePendingIds.length ? 'images_pending' :
          report.pendingReviewIds.length || report.notPublishedIds.length ? 'products_pending' : 'catalog_matches' });
      if (!performImport) return await finish(record, { ...report, status: 'catalog_mismatch' });
      if (!configuration.enabled) return await finish(record, { ...report, status: 'sync_disabled' });
      if (!configuration.production) return await finish(record, { ...report, status: 'production_required' });
      if (record.state.lastCompletedHash === audit.fingerprint) return await finish(record, { ...report, status: 'review_required', reason: 'completed_import_still_differs' });
      // The feed is mutable: revalidate immediately before claiming an upload.
      if (deadline - runtimeNow() < 60_000) return await finish(record, { ...report, status: 'check_deferred', reason: 'meta_catalog_budget_exhausted' });
      const latest = await source(record);
      if (!latest.valid || latest.fingerprint !== audit.fingerprint || latest.feedUrl !== audit.feedUrl || latest.imageRevision !== audit.imageRevision ||
          latest.additionalImageRevision !== audit.additionalImageRevision)
        return await finish(record, { ...report, status: 'source_changed', reason: latest.reason || 'source_changed_during_check' });
      if (deadline - runtimeNow() < 30_000) return await finish(record, { ...report, status: 'check_deferred', reason: 'meta_catalog_budget_exhausted' });
      record.state.active = { attemptId: randomUUID(), phase: 'requesting', startedAt: timestamp(), fingerprint: audit.fingerprint, feedUrl: audit.feedUrl,
        seenUploadIds: remote.uploads.map((upload) => upload.id), uploadId: null };
      try { await save(record); } catch (error) { if (conflict(error)) return publicResult({ ...report, ok: true, status: 'busy' }); throw fail('meta_catalog_state_unavailable'); }
      try {
        const uploaded = await graph(`${feedId}/uploads`, auth.token, { method: 'POST', body: { url: audit.feedUrl, update_only: 'false' }, deadline });
        if (!numericId(uploaded.id)) throw fail('meta_catalog_response_unknown');
        record.state.active.uploadId = String(uploaded.id); record.state.active.phase = 'submitted';
        return await finish(record, { ...report, ok: true, status: 'import_requested', import: { ...report.import, pending: true, requestedId: uploaded.id } });
      } catch (error) {
        // A conclusive 4xx is a rejected request. Transport/5xx/invalid results
        // retain the intent, preventing another POST until remote reconciliation.
        const rejected = error.code === 'meta_catalog_provider_rejected' && error.metaStatus >= 400 && error.metaStatus < 500;
        if (rejected) record.state.active = null; else record.state.active.phase = 'unknown';
        return await finish(record, { ...report, status: rejected ? 'import_rejected' : 'import_unknown', reason: safeCode(error.code), metaStatus: error.metaStatus, metaCode: error.metaCode });
      }
    } catch (error) {
      return await finish(record, { ...report, status: error.code === 'meta_catalog_deadline_exceeded' ? 'check_deferred' : 'check_failed', reason: safeCode(error.code), metaStatus: error.metaStatus, metaCode: error.metaCode, feedScheduleCheck: error.feedScheduleCheck });
    }
  }

  async function status() {
    const { state } = await read();
    return { ok: true, configuration, lastResult: state.lastResult ? publicResult(state.lastResult) : null,
      active: state.active ? { phase: state.active.phase, startedAt: date(state.active.startedAt), uploadId: numericId(state.active.uploadId) ? state.active.uploadId : null } : null };
  }
  return { status, check: () => inspect(false), run: () => inspect(true) };
}

