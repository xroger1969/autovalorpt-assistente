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
    const { device, active, lastResult } = record.state;
    return {
      ok: true, role: context.admin ? 'admin' : 'device', number: WHATSAPP_STATUS_NUMBER,
      automation: 'pending_end_to_end_test', providerApiVerified: false,
      device: device ? { id: device.id, createdAt: device.createdAt, expiresAt: device.expiresAt,
        revokedAt: device.revokedAt || null, valid: Boolean(deviceValid(device)), thisDevice: ownDevice === device.id } : null,
      initialized: Boolean(record.state.initializedAt), blocked: Boolean(active),
      active: active && (context.admin || active.deviceId === ownDevice) ? active : null,
      lastResult: lastResult && (context.admin || lastResult.deviceId === ownDevice) ? lastResult : null,
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
  async function snapshot(record) {
    const [audit, stories] = await Promise.all([
      source.audit({ previousExpectedCount: record.state.lastExpectedCount || 0 }), readJson(STORIES),
    ]);
    if (!audit.valid || !Array.isArray(audit.items) || !audit.items.length) throw fail('status_source_unverified');
    const age = now() - Date.parse(audit.checkedAt);
    if (!Number.isFinite(age) || age < -30000 || age > 120000) throw fail('status_source_unverified');
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
    const active = { attemptId: randomUUID(), deviceId, ...publicAsset(next), phase: 'reserved', startedAt: timestamp() };
    record.state.active = active;
    record.state.items[next.id] = { status: 'reserved', fingerprint: next.fingerprint, attemptId: active.attemptId, at: timestamp() };
    record.state.lastExpectedCount = data.audit.expectedCount;
    await save(record);
    return summary(record, context);
  }
  function ownAttempt(record, context, input) {
    const deviceId = authorized(record, context, true); const active = record.state.active;
    if (!active || active.deviceId !== deviceId || active.attemptId !== input?.attemptId) throw fail('status_attempt_mismatch');
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
      status: 'observed_published', at: timestamp(), observedAt: input.observedAt, observation: input.observation.trim(),
      confirmationSource: 'whatsapp_web_observation', providerApiVerified: false };
    record.state.items[active.id] = result; record.state.lastResult = result;
    record.state.lastPublishedDay = day(now()); record.state.active = null;
    await save(record); return summary(record, context);
  }
  async function uncertain(context, input) {
    const record = await read(); const active = ownAttempt(record, context, input);
    active.phase = 'unknown'; active.updatedAt = timestamp();
    record.state.items[active.id].status = 'unknown';
    await save(record); return summary(record, context);
  }
  async function close(context, input) {
    if (context?.admin !== true) throw fail('status_unauthorized');
    const record = await read(); const active = record.state.active;
    if (!active || active.attemptId !== input?.attemptId || input?.doNotRepeat !== true) throw fail('status_attempt_mismatch');
    // Human reconciliation releases the global lock, but permanently consumes
    // this vehicle ID. It cannot assert publication or authorize another send.
    const result = { id: active.id, deviceId: active.deviceId, attemptId: active.attemptId, fingerprint: active.fingerprint,
      status: 'closed_without_publication_confirmation', at: timestamp(), providerApiVerified: false };
    record.state.items[active.id] = result; record.state.lastResult = result; record.state.active = null;
    await save(record); return summary(record, context);
  }
  return { status, enroll, revoke, plan, claim, media, begin, confirm, uncertain, close };
}
