import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { adminConfigured } from './admin-security.js';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { storyFingerprint } from './instagram-stories.js';
import { instagramVideoPath } from './instagram-video-access.js';
import { createMetaCatalogSource } from './meta-catalog-source.js';

export const WHATSAPP_STATUS_COOKIE = '__Host-avpt_wa_status';
export const WHATSAPP_STATUS_SECONDS = 90 * 24 * 60 * 60;
export const WHATSAPP_STATUS_NUMBER = '+351965637736';
export const WHATSAPP_STATUS_PATH = 'whatsapp-status/v1/production/state.json';
const STORIES = 'instagram/v1/production/stories.json';
const MAX_ITEMS = 5000;
const MAX_BYTES = 30 * 1024 * 1024;
const STATUS_WINDOW_MS = 24 * 60 * 60 * 1000;
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const day = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const safeText = value => typeof value === 'string' && value.length <= 300 && !/[\u0000-\u001f<>]/.test(value);

export function whatsappStatusCookie(value = '', maxAge = WHATSAPP_STATUS_SECONDS) {
  return `${WHATSAPP_STATUS_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

// This service never calls a publishing API, renders a video, or writes an
// Instagram ledger. The device capability is accepted by this router only.
export function createWhatsappStatus(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const source = options.source || createMetaCatalogSource(options);
  const now = options.now || Date.now;
  const timestamp = () => new Date(now()).toISOString();
  const sourceHash = hash(env.INSTAGRAM_FEED_URL || '');
  const binding = { version: 1, number: WHATSAPP_STATUS_NUMBER, sourceHash, accountId: String(env.INSTAGRAM_USER_ID || '') };
  const accessBinding = () => createHmac('sha256', String(env.ADMIN_SESSION_SECRET || '')).update(`whatsapp-status:v1:${env.ADMIN_ACCESS_HASH || ''}`).digest('hex');
  const dailyUsed = state => state.lastStartedDay === day(now()) || state.lastPublishedDay === day(now());

  async function readJson(path) {
    const result = await readInstagramBlob(storage, path);
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('status_storage_unavailable');
    const text = await new Response(result.stream).text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw fail('status_state_invalid');
    let state;
    try { state = JSON.parse(text); } catch { throw fail('status_state_invalid'); }
    if (!state || state.version !== 1 || !state.items || typeof state.items !== 'object' || Array.isArray(state.items) || Object.keys(state.items).length > MAX_ITEMS) throw fail('status_state_invalid');
    return { state, etag: result.blob.etag };
  }
  async function read() {
    if (env.VERCEL_ENV !== 'production' || !adminConfigured(env)) throw fail('status_not_configured');
    const record = await readJson(WHATSAPP_STATUS_PATH);
    if (record && Object.entries(binding).some(([key, value]) => record.state[key] !== value)) throw fail('status_binding_changed');
    return record || { etag: null, state: { ...binding, items: {}, device: null, active: null, initializedAt: null, lastExpectedCount: 0, lastResult: null } };
  }
  async function save(record) {
    try {
      const result = await storage.put(WHATSAPP_STATUS_PATH, JSON.stringify(record.state), {
        access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
        ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(8000),
      });
      if (!result.etag) throw fail('status_storage_unavailable');
      record.etag = result.etag;
    } catch (error) {
      if (instagramStorageConflict(error) || error?.code === 'blob_read_version_changed') throw fail('status_conflict');
      throw fail('status_storage_unavailable');
    }
  }
  function deviceValid(device) {
    return device && !device.revokedAt && device.accessBinding === accessBinding() &&
      Number.isFinite(Date.parse(device.createdAt)) && Date.parse(device.createdAt) <= now() &&
      Date.parse(device.expiresAt) > now() && Date.parse(device.expiresAt) - Date.parse(device.createdAt) === WHATSAPP_STATUS_SECONDS * 1000;
  }
  function authorized(record, context, deviceOnly = false) {
    const device = record.state.device;
    const token = String(context?.token || '');
    const matches = deviceValid(device) && /^[A-Za-z0-9_-]{43}$/.test(token) && /^[a-f0-9]{64}$/.test(device.tokenHash || '') &&
      timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(device.tokenHash, 'hex'));
    if (!matches && (deviceOnly || context?.admin !== true)) throw fail('status_unauthorized');
    return matches ? device.id : null;
  }
  function summary(record, context) {
    const ownDevice = authorized(record, context);
    const { device, active, lastResult, lastWithdrawalResult } = record.state;
    const publicationObserved = Object.values(record.state.items).some(item => item.status === 'observed_published' && item.deviceId === device?.id);
    return {
      ok: true, role: context.admin ? 'admin' : 'device', number: WHATSAPP_STATUS_NUMBER,
      automation: publicationObserved ? 'publication_observed_scheduled_test_pending' : 'pending_end_to_end_test', providerApiVerified: false,
      device: device ? { id: device.id, createdAt: device.createdAt, expiresAt: device.expiresAt,
        revokedAt: device.revokedAt || null, valid: Boolean(deviceValid(device)), thisDevice: ownDevice === device.id } : null,
      initialized: Boolean(record.state.initializedAt), blocked: Boolean(active),
      active: active && (context.admin || active.deviceId === ownDevice) ? active : null,
      lastResult: lastResult && (context.admin || lastResult.deviceId === ownDevice) ? lastResult : null,
      lastWithdrawalResult: lastWithdrawalResult && (context.admin || lastWithdrawalResult.deviceId === ownDevice) ? lastWithdrawalResult : null,
      history: context.admin ? Object.entries(record.state.items).filter(([, item]) => item.status === 'observed_published')
        .map(([id, item]) => ({ id, ...item })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10) : [],
    };
  }
  async function status(context) { const record = await read(); return summary(record, context); }
  async function enroll(context) {
    if (context?.admin !== true) throw fail('status_unauthorized');
    const record = await read();
    if (record.state.active) throw fail('status_attempt_pending');
    if (deviceValid(record.state.device)) throw fail('status_device_exists');
    const token = randomBytes(32).toString('base64url');
    record.state.device = { id: randomUUID(), tokenHash: hash(token), accessBinding: accessBinding(), createdAt: timestamp(), expiresAt: new Date(now() + WHATSAPP_STATUS_SECONDS * 1000).toISOString() };
    await save(record);
    return { cookie: whatsappStatusCookie(token), data: summary(record, { ...context, token }) };
  }
  async function revoke(context) {
    if (context?.admin !== true) throw fail('status_unauthorized');
    const record = await read();
    if (record.state.device) record.state.device.revokedAt = timestamp();
    // Revocation cannot erase a possibly published attempt or make it retryable.
    if (record.state.active) record.state.active.phase = 'unknown';
    await save(record);
    return { cookie: whatsappStatusCookie('', 0), data: summary(record, { admin: true }) };
  }
  async function sourceSnapshot(record) {
    const audit = await source.audit({ previousExpectedCount: record.state.lastExpectedCount || 0 });
    if (!audit.valid || !Array.isArray(audit.items) || !audit.items.length) throw fail('status_source_unverified');
    const age = now() - Date.parse(audit.checkedAt);
    if (!Number.isFinite(age) || age < -30000 || age > 120000) throw fail('status_source_unverified');
    return audit;
  }
  async function snapshot(record) {
    const [audit, stories] = await Promise.all([sourceSnapshot(record), readJson(STORIES)]);
    const expected = { version: 1, accountId: binding.accountId, facebookId: String(env.INSTAGRAM_RETIREMENTS_USER_ID || ''), pageId: String(env.INSTAGRAM_RETIREMENTS_PAGE_ID || ''), sourceHash, publicationProvider: 'instagram' };
    if (!stories || Object.entries(expected).some(([key, value]) => stories.state[key] !== value)) throw fail('status_video_binding_changed');
    return { audit, stories: stories.state };
  }
  async function asset(data, id, fingerprint) {
    const item = data.audit.items.find(value => value.id === id);
    const entry = data.stories.items[id];
    if (!item || item.availability !== 'in stock' || storyFingerprint(item) !== fingerprint ||
      entry?.status !== 'published' || !/^\d{5,30}$/.test(String(entry.instagramMediaId || '')) || entry.fingerprint !== fingerprint ||
      entry.videoPath !== instagramVideoPath(id, fingerprint)) throw fail('status_video_changed');
    const meta = await storage.head(entry.videoPath, { abortSignal: AbortSignal.timeout(8000) });
    if (meta.contentType !== 'video/mp4' || !Number.isSafeInteger(meta.size) || meta.size < 1000 || meta.size > MAX_BYTES || !meta.etag) throw fail('status_video_unavailable');
    return { id, fingerprint, title: item.title, price: item.price, publishedAt: entry.at, bytes: meta.size, path: entry.videoPath, etag: meta.etag };
  }
  function publicAsset(value) { const { path, etag, ...result } = value; return result; }
  async function candidate(record, data) {
    const values = data.audit.items.filter(item => !record.state.items[item.id] && item.availability === 'in stock')
      .map(item => ({ item, entry: data.stories.items[item.id] }))
      .filter(({ item, entry }) => entry?.status === 'published' && entry.fingerprint === storyFingerprint(item) && Number.isFinite(Date.parse(entry.at)) && Date.parse(entry.at) <= now())
      .sort((a, b) => Date.parse(b.entry.at) - Date.parse(a.entry.at) || a.item.id.localeCompare(b.item.id));
    return values.length ? asset(data, values[0].item.id, values[0].entry.fingerprint) : null;
  }
  async function plan(context) {
    const record = await read(); authorized(record, context);
    if (record.state.active) return { ...summary(record, context), candidate: null, reason: 'status_attempt_pending' };
    if (dailyUsed(record.state)) return { ...summary(record, context), candidate: null, reason: 'status_daily_limit' };
    const data = await snapshot(record); const next = await candidate(record, data);
    return { ...summary(record, context), candidate: next ? publicAsset(next) : null, wouldInitializeBaseline: !record.state.initializedAt, checkedAt: data.audit.checkedAt };
  }
  async function claim(context, input) {
    const record = await read(); const deviceId = authorized(record, context, true);
    if (record.state.active) throw fail('status_attempt_pending');
    if (dailyUsed(record.state)) throw fail('status_daily_limit');
    const data = await snapshot(record); const next = await candidate(record, data);
    if (!next || input?.id !== next.id || input?.fingerprint !== next.fingerprint) throw fail('status_candidate_changed');
    if (Object.keys(record.state.items).length + data.audit.items.length > MAX_ITEMS) throw fail('status_state_capacity');
    if (!record.state.initializedAt) {
      record.state.initializedAt = timestamp();
      for (const item of data.audit.items) record.state.items[item.id] = { status: 'baseline', at: timestamp() };
    }
    const active = { attemptId: randomUUID(), kind: 'publication', deviceId, ...publicAsset(next), phase: 'reserved', startedAt: timestamp() };
    record.state.active = active;
    record.state.items[next.id] = { status: 'reserved', fingerprint: next.fingerprint, attemptId: active.attemptId, at: timestamp() };
    record.state.lastExpectedCount = data.audit.expectedCount;
    await save(record);
    return summary(record, context);
  }
  function ownAttempt(record, context, input, kind = 'publication') {
    const deviceId = authorized(record, context, true); const active = record.state.active;
    if (!active || active.deviceId !== deviceId || active.attemptId !== input?.attemptId || kind && (active.kind || 'publication') !== kind) throw fail('status_attempt_mismatch');
    return active;
  }
  async function media(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input);
    if (active.phase !== 'reserved') throw fail('status_attempt_pending');
    const selected = await asset(await snapshot(record), active.id, active.fingerprint);
    const result = await storage.get(selected.path, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' }, abortSignal: AbortSignal.timeout(15000) });
    if (!result || result.statusCode !== 200 || result.blob?.etag?.replace(/^W\//, '') !== selected.etag) {
      await result?.stream?.cancel().catch(() => {}); throw fail('status_video_unavailable');
    }
    // Recheck revocation before returning a body after the source/network reads.
    try {
      const current = await read(); ownAttempt(current, context, input);
      if (current.state.active.phase !== 'reserved') throw fail('status_attempt_pending');
    } catch (error) { await result.stream.cancel().catch(() => {}); throw error; }
    return { stream: result.stream, bytes: selected.bytes, id: selected.id };
  }
  async function begin(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input);
    if (active.phase !== 'reserved') throw fail('status_attempt_pending');
    if (dailyUsed(record.state)) throw fail('status_daily_limit');
    if (input?.account !== WHATSAPP_STATUS_NUMBER) throw fail('status_account_unverified');
    await asset(await snapshot(record), active.id, active.fingerprint);
    active.phase = 'publishing'; active.publicationStartedAt = timestamp();
    // A lost/unknown result may already be a live State. Closing the attempt
    // must never release its daily send allowance.
    record.state.lastStartedDay = day(now());
    await save(record); return summary(record, context);
  }
  async function confirm(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input);
    if (!['publishing', 'unknown'].includes(active.phase) || !active.publicationStartedAt) throw fail('status_publication_not_started');
    const observed = Date.parse(input?.observedAt);
    if (input?.account !== WHATSAPP_STATUS_NUMBER || input?.visibleInMyStatus !== true || input?.id !== active.id || input?.fingerprint !== active.fingerprint ||
      !safeText(input?.observation) || input.observation.trim().length < 12 || !Number.isFinite(observed) || observed < Date.parse(active.publicationStartedAt) || observed > now() + 30000 || now() - observed > 10 * 60_000) throw fail('status_observation_required');
    const result = { id: active.id, deviceId: active.deviceId, attemptId: active.attemptId, fingerprint: active.fingerprint,
      title: active.title, price: active.price, publicationStartedAt: active.publicationStartedAt,
      status: 'observed_published', at: timestamp(), observedAt: input.observedAt, observation: input.observation.trim(),
      confirmationSource: 'whatsapp_web_observation', providerApiVerified: false };
    record.state.items[active.id] = result; record.state.lastResult = result;
    record.state.lastPublishedDay = day(now()); record.state.active = null;
    await save(record); return summary(record, context);
  }
  async function uncertain(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input, null);
    active.phase = 'unknown'; active.updatedAt = timestamp();
    if (active.kind !== 'withdrawal') record.state.items[active.id].status = 'unknown';
    await save(record); return summary(record, context);
  }
  async function close(context, input) {
    if (context?.admin !== true) throw fail('status_unauthorized');
    const record = await read(); const active = record.state.active;
    if (!active || active.attemptId !== input?.attemptId || input?.doNotRepeat !== true) throw fail('status_attempt_mismatch');
    if (active.kind === 'withdrawal') {
      const original = withdrawalPublication(record, active);
      const result = { id: active.id, deviceId: active.deviceId, attemptId: active.attemptId,
        publicationAttemptId: active.publicationAttemptId, fingerprint: active.fingerprint,
        status: 'closed_without_removal_confirmation', at: timestamp(), providerApiVerified: false };
      original.withdrawal = result; record.state.lastWithdrawalResult = result; record.state.active = null;
      await save(record); return summary(record, context);
    }
    // Human reconciliation releases the global lock, but permanently consumes
    // this vehicle ID. It cannot assert publication or authorize another send.
    const result = { id: active.id, deviceId: active.deviceId, attemptId: active.attemptId, fingerprint: active.fingerprint,
      status: 'closed_without_publication_confirmation', at: timestamp(), providerApiVerified: false };
    record.state.items[active.id] = result; record.state.lastResult = result; record.state.active = null;
    await save(record); return summary(record, context);
  }

  function withdrawalPublication(record, active) {
    const entry = record.state.items[active.id];
    if (!entry || entry.status !== 'observed_published' || entry.deviceId !== active.deviceId ||
        entry.attemptId !== active.publicationAttemptId || entry.fingerprint !== active.fingerprint || entry.withdrawal) throw fail('status_withdrawal_changed');
    return entry;
  }
  function observedWindow(entry) {
    const at = Date.parse(entry?.observedAt);
    if (!Number.isFinite(at) || at > now()) return null;
    const started = Date.parse(entry.publicationStartedAt);
    // A late observation after a crash must not extend the selection window.
    // Older records without the start marker retain the observation fallback.
    const useStart = Number.isFinite(started) && started <= at;
    const from = useStart ? started : at;
    return { observedAt: entry.observedAt, windowStartedAt: new Date(from).toISOString(), windowFrom: useStart ? 'publication_started' : 'observation',
      windowEndsAt: new Date(from + STATUS_WINDOW_MS).toISOString(), elapsed: now() >= from + STATUS_WINDOW_MS };
  }
  function withdrawalCandidate(id, entry, audit) {
    const window = observedWindow(entry);
    if (entry.status !== 'observed_published' || entry.withdrawal || !window || window.elapsed) return null;
    const current = audit.items.find(item => item.id === id);
    // A missing row is not proof of withdrawal. The same complete source audit
    // must include an explicit out-of-stock Stock row, or changed current data.
    const reason = !current && audit.outOfStockIds?.includes(id) ? 'out_of_stock' :
      current?.availability === 'in stock' && storyFingerprint(current) !== entry.fingerprint ? 'data_changed' : null;
    if (!reason) return null;
    return { id, fingerprint: entry.fingerprint, publicationAttemptId: entry.attemptId, deviceId: entry.deviceId,
      title: safeText(entry.title) ? entry.title : `Viatura ${id}`, price: safeText(entry.price) ? entry.price : null,
      publicationObservation: safeText(entry.observation) ? entry.observation : '', reason,
      observedAt: window.observedAt, windowEndsAt: window.windowEndsAt, sourceCheckedAt: audit.checkedAt };
  }
  async function withdrawalPlan(context) {
    const record = await read(); const deviceId = authorized(record, context);
    const entries = Object.entries(record.state.items).filter(([, entry]) => entry.status === 'observed_published' && (context.admin || entry.deviceId === deviceId));
    const elapsed = entries.filter(([, entry]) => observedWindow(entry)?.elapsed && entry.withdrawal?.status !== 'observed_removed')
      .map(([id, entry]) => ({ id, status: 'window_elapsed', kind: 'window_elapsed', ...observedWindow(entry), deletionConfirmed: false }));
    if (record.state.active) return { ...summary(record, context), candidates: [], elapsed, reason: 'status_attempt_pending', sourceVerified: false };
    if (!entries.some(([, entry]) => !entry.withdrawal && observedWindow(entry) && !observedWindow(entry).elapsed))
      return { ...summary(record, context), candidates: [], elapsed, reason: 'status_no_live_publications', sourceVerified: false };
    const audit = await sourceSnapshot(record);
    const candidates = entries.map(([id, entry]) => withdrawalCandidate(id, entry, audit)).filter(Boolean)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
    return { ...summary(record, context), candidates, elapsed, sourceVerified: true, checkedAt: audit.checkedAt };
  }
  async function withdrawalClaim(context, input) {
    const record = await read(); const deviceId = authorized(record, context, true);
    if (record.state.active) throw fail('status_attempt_pending');
    const entry = record.state.items[input?.id];
    if (!entry || entry.deviceId !== deviceId || entry.attemptId !== input?.publicationAttemptId || entry.fingerprint !== input?.fingerprint) throw fail('status_withdrawal_changed');
    const audit = await sourceSnapshot(record); const selected = withdrawalCandidate(input.id, entry, audit);
    if (!selected) throw fail('status_withdrawal_changed');
    record.state.active = { ...selected, attemptId: randomUUID(), kind: 'withdrawal', phase: 'reserved', startedAt: timestamp() };
    record.state.lastExpectedCount = audit.expectedCount;
    await save(record); return summary(record, context);
  }
  function observationMatches(active, input, since) {
    const at = Date.parse(input?.observedAt);
    return input?.account === WHATSAPP_STATUS_NUMBER && input?.id === active.id && input?.fingerprint === active.fingerprint &&
      input?.publicationAttemptId === active.publicationAttemptId && safeText(input?.observation) && input.observation.trim().length >= 12 &&
      Number.isFinite(at) && at >= Date.parse(since) && at <= now() + 30000 && now() - at <= 10 * 60_000;
  }
  async function withdrawalBegin(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input, 'withdrawal');
    if (active.phase !== 'reserved') throw fail('status_attempt_pending');
    const entry = withdrawalPublication(record, active);
    if (!observationMatches(active, input, active.startedAt) || input?.visibleInMyStatus !== true || input?.identityUnambiguous !== true) throw fail('status_removal_observation_required');
    const audit = await sourceSnapshot(record); const selected = withdrawalCandidate(active.id, entry, audit);
    if (!selected) throw fail('status_withdrawal_changed');
    active.reason = selected.reason; active.sourceCheckedAt = selected.sourceCheckedAt;
    active.phase = 'deleting'; active.deletionStartedAt = timestamp();
    active.beforeObservation = input.observation.trim(); active.beforeObservedAt = input.observedAt;
    record.state.lastExpectedCount = audit.expectedCount;
    await save(record); return summary(record, context);
  }
  async function withdrawalConfirm(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input, 'withdrawal');
    if (!['deleting', 'unknown'].includes(active.phase) || !active.deletionStartedAt) throw fail('status_removal_not_started');
    const original = withdrawalPublication(record, active);
    if (!observationMatches(active, input, active.deletionStartedAt) || input?.deletionActionObserved !== true || input?.absentFromMyStatus !== true) throw fail('status_removal_observation_required');
    const result = { id: active.id, deviceId: active.deviceId, attemptId: active.attemptId, publicationAttemptId: active.publicationAttemptId,
      fingerprint: active.fingerprint, reason: active.reason, status: 'observed_removed', at: timestamp(),
      observedAt: input.observedAt, observation: input.observation.trim(), beforeObservation: active.beforeObservation,
      beforeObservedAt: active.beforeObservedAt, confirmationSource: 'whatsapp_web_observation', providerApiVerified: false };
    original.withdrawal = result; record.state.lastWithdrawalResult = result; record.state.active = null;
    await save(record); return summary(record, context);
  }
  return { status, enroll, revoke, plan, claim, media, begin, confirm, uncertain, close,
    withdrawalPlan, withdrawalClaim, withdrawalBegin, withdrawalConfirm,
    'withdrawal-plan': withdrawalPlan, 'withdrawal-claim': withdrawalClaim, 'withdrawal-begin': withdrawalBegin, 'withdrawal-confirm': withdrawalConfirm };
}
