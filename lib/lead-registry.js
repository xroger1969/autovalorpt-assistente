import { createHash, randomUUID } from 'node:crypto';
import { get, put, list, del } from '@vercel/blob';

export const CHANNELS = Object.freeze(['onesignal', 'slack', 'whatsapp']);
const ID_PATTERN = /^[a-f0-9]{32}$/;
const REQUEST_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LEASE_MS = 90_000;
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');

export function cleanLeadText(value = '', max = 500) {
  return String(value || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeLeadPhone(value = '') {
  const raw = String(value || '').trim();
  if (!/^(?:\+351|00351|351)?[\d\s().-]+$/.test(raw)) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('00351')) digits = digits.slice(5);
  else if (digits.length === 12 && digits.startsWith('351')) digits = digits.slice(3);
  return /^9\d{8}$/.test(digits) ? digits : '';
}

export function normalizeLead(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const lead = {};
  for (const [key, max] of Object.entries({ name: 80, vehicle: 220, subjects: 300, visit: 300, financing: 500, tradeIn: 500, registration: 20, observations: 1600 })) {
    lead[key] = cleanLeadText(input[key], max);
  }
  lead.phone = normalizeLeadPhone(input.phone);
  lead.vehicleUrl = '';
  if (input.vehicleUrl) {
    try {
      const url = new URL(String(input.vehicleUrl));
      if (url.protocol === 'https:' && (url.hostname === 'standvirtual.com' || url.hostname.endsWith('.standvirtual.com'))) lead.vehicleUrl = url.href.slice(0, 700);
    } catch { /* An invalid optional link is not stored. */ }
  }
  if (!lead.name || !/^[\p{L}\p{M}'’\- ]{2,80}$/u.test(lead.name) || !/\p{L}/u.test(lead.name) || !lead.phone) return null;
  if (!lead.subjects && !lead.observations && !lead.visit && !lead.financing && !lead.tradeIn) return null;
  return lead;
}

export function leadNamespace(env = process.env) {
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') return `preview-${sha(env.VERCEL_GIT_COMMIT_REF || 'preview').slice(0, 12)}`;
  return 'development';
}

export function leadIdForRequest(requestId, namespace = leadNamespace()) {
  if (!REQUEST_PATTERN.test(String(requestId))) return '';
  return sha(`${namespace}:${String(requestId).toLowerCase()}`).slice(0, 32);
}

export function payloadFingerprint(lead, batchId = '') { return sha(JSON.stringify({ lead, batchId })); }
export function receiptFor(record) { return `CV-${String(record.createdAt).slice(0, 10).replaceAll('-', '')}-${record.id.slice(0, 8).toUpperCase()}`; }
export function storageConflict(error) { return /Precondition|AlreadyExists/.test(error?.name || '') || [409, 412].includes(error?.status) || /already exists/i.test(error?.message || ''); }

export function createLeadRepository(options = {}) {
  const storage = options.storage || { get, put, list, del };
  const now = options.now || (() => Date.now());
  const namespace = options.namespace || leadNamespace();
  const prefix = `leads/v1/${namespace}/`;
  const recoveryScanPath = `${prefix}recovery/scan.json`;
  const idPath = (id) => { if (!ID_PATTERN.test(String(id))) throw new Error('invalid_lead_id'); return `${prefix}records/${id}.json`; };
  const reservationPath = (id) => { idPath(id); return `${prefix}requests/${id}.json`; };
  const channelPath = (id, channel) => { idPath(id); if (!CHANNELS.includes(channel)) throw new Error('invalid_channel'); return `${prefix}delivery/${id}/${channel}.json`; };
  const inboxPath = (record) => `${prefix}inbox/${String(9999999999999 - Date.parse(record.createdAt)).padStart(13, '0')}-${record.id}.json`;
  const outboxPath = (record) => `${prefix}outbox/${String(Date.parse(record.createdAt)).padStart(13, '0')}-${record.id}.json`;

  async function read(path) {
    const result = await storage.get(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(10_000) });
    if (!result || result.statusCode !== 200) return null;
    const etag = result.blob?.etag;
    if (!etag) throw new Error('storage_etag_missing');
    return { value: JSON.parse(await new Response(result.stream).text()), etag };
  }

  async function write(path, value, etag = '') {
    return storage.put(path, JSON.stringify(value), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(etag),
      ...(etag ? { ifMatch: etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(10_000)
    });
  }

  async function ensureIndex(path, id) {
    try { await write(path, { id }); } catch (error) { if (!storageConflict(error)) throw error; }
  }

  async function loadRecord(id) { return (await read(idPath(id)))?.value || null; }

  async function saveSubmission({ requestId, lead, photoSession, attachPhotos, source = 'assistant' }) {
    const id = leadIdForRequest(requestId, namespace);
    if (!id) throw Object.assign(new Error('invalid_request_id'), { status: 400 });
    const fingerprint = payloadFingerprint(lead, photoSession?.batchId || '');
    let record = await loadRecord(id);
    if (!record) {
      // Reserve the immutable payload before attaching photographs. Concurrent
      // requests cannot claim a photo batch and then lose the lead-create race.
      let reservation = { fingerprint, createdAt: new Date(now()).toISOString() };
      try { await write(reservationPath(id), reservation); }
      catch (error) {
        if (!storageConflict(error)) throw error;
        const existing = await read(reservationPath(id));
        if (!existing || existing.value.fingerprint !== fingerprint) {
          throw Object.assign(new Error('request_id_conflict'), { status: 409 });
        }
        reservation = existing.value;
      }
      const photos = photoSession ? await attachPhotos(photoSession, id) : null;
      const createdAt = reservation.createdAt;
      const incoming = { version: 1, id, fingerprint, ...lead, photos, source, status: 'new', createdAt, updatedAt: createdAt };
      // Write discoverability/recovery entries first. A canonical record can
      // never be created by this path without both indexes already durable.
      // The reserved timestamp keeps index paths identical on later retries.
      await ensureIndex(inboxPath(incoming), id);
      await ensureIndex(outboxPath(incoming), id);
      try { await write(idPath(id), incoming); record = incoming; }
      catch (error) {
        if (!storageConflict(error)) throw error;
        record = await loadRecord(id);
        if (!record) throw error;
      }
    }
    if (record.fingerprint !== fingerprint) throw Object.assign(new Error('request_id_conflict'), { status: 409 });
    // The inbox and recovery entry are durable before any notification is sent.
    await ensureIndex(inboxPath(record), id);
    await ensureIndex(outboxPath(record), id);
    return record;
  }

  async function deliveryState(id, channel) { return (await read(channelPath(id, channel)))?.value || { status: 'pending', attempts: 0 }; }
  async function notifications(id) {
    return Object.fromEntries(await Promise.all(CHANNELS.map(async (channel) => [channel, await deliveryState(id, channel)])));
  }

  async function ensureRecovery(record) {
    const path = outboxPath(record);
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await read(path);
      try {
        const result = await write(path, { id: record.id, recoveryId: randomUUID() }, existing?.etag);
        return { path, etag: result.etag };
      } catch (error) { if (!storageConflict(error)) throw error; }
    }
    throw new Error('recovery_index_conflict');
  }

  async function claimDelivery(id, channel, { allowUnknown = false, manual = false } = {}) {
    const path = channelPath(id, channel);
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await read(path);
      const previous = existing?.value;
      if (previous?.status === 'accepted' || previous?.status === 'delivered') return null;
      if (previous?.status === 'failed' && previous.retryable === false && !manual) return null;
      if (previous?.status === 'sending' && now() - Date.parse(previous.updatedAt) < LEASE_MS) return null;
      if (previous?.status === 'unknown' && !allowUnknown) return null;
      // Slack and Meta do not provide the OneSignal idempotency guarantee.
      if (previous?.status === 'sending' && channel !== 'onesignal' && !allowUnknown) {
        try { await write(path, { ...previous, status: 'unknown', error: 'delivery_not_confirmed', updatedAt: new Date(now()).toISOString() }, existing.etag); }
        catch (error) { if (!storageConflict(error)) throw error; }
        return null;
      }
      const state = { status: 'sending', attempts: (previous?.attempts || 0) + 1, attemptId: randomUUID(), updatedAt: new Date(now()).toISOString() };
      try {
        const result = await write(path, state, existing?.etag);
        return { state, etag: result.etag, path };
      } catch (error) { if (!storageConflict(error)) throw error; }
    }
    return null;
  }

  async function finishDelivery(claim, result) {
    const state = { ...claim.state, ...result, updatedAt: new Date(now()).toISOString() };
    await write(claim.path, state, claim.etag);
    return state;
  }

  async function settleOutbox(record, states, recoveryClaim = null) {
    // Unknown deliveries are kept visible for human review; they are not resent automatically.
    const needsRetry = CHANNELS.some((channel) => {
      const state = states[channel] || { status: 'pending' };
      return ['pending', 'sending'].includes(state.status) || (state.status === 'failed' && state.retryable !== false);
    });
    if (!needsRetry) {
      const path = outboxPath(record);
      const etag = recoveryClaim?.etag || (await read(path))?.etag;
      if (!etag) return;
      try { await storage.del(path, { ifMatch: etag }); }
      catch (error) { if (!storageConflict(error)) throw error; }
    }
  }

  async function page({ cursor, limit = 20, outbox = false, maxScans = 5 } = {}) {
    const pageLimit = Math.max(1, Math.min(50, limit));
    const records = [];
    let next = cursor;
    for (let scan = 0; scan < Math.max(1, Math.min(5, maxScans)); scan++) {
      const result = await storage.list({ prefix: `${prefix}${outbox ? 'outbox' : 'inbox'}/`, limit: pageLimit - records.length, ...(next ? { cursor: next } : {}), abortSignal: AbortSignal.timeout(10_000) });
      const ids = (result.blobs || []).map((blob) => String(blob.pathname).match(/-([a-f0-9]{32})\.json$/)?.[1]).filter(Boolean);
      for (let i = 0; i < ids.length; i += 5) records.push(...(await Promise.all(ids.slice(i, i + 5).map(loadRecord))).filter(Boolean));
      next = result.hasMore ? result.cursor : null;
      // An interrupted pre-record write can leave an index entry without PII.
      // Skip such entries so they do not hide the next complete requests.
      if (records.length >= pageLimit || !next) break;
    }
    return { items: records, cursor: next };
  }

  async function updateRecoveryScan(claim, changes) {
    const state = { ...claim.state, ...changes, updatedAt: new Date(now()).toISOString() };
    const saved = await write(recoveryScanPath, state, claim.etag);
    claim.state = state;
    claim.etag = saved.etag;
    return claim;
  }

  async function claimRecoveryScan({ limit = 8 } = {}) {
    const batchLimit = Math.max(1, Math.min(8, limit));
    let claim;
    for (let attempt = 0; attempt < 5; attempt++) {
      const previous = await read(recoveryScanPath);
      const state = previous?.value || {};
      if (state.leaseId && Number(state.leaseUntil) > now()) return null;
      const next = {
        version: 1,
        cursor: typeof state.cursor === 'string' && state.cursor ? state.cursor : null,
        pendingIds: Array.isArray(state.pendingIds) ? state.pendingIds.filter((id) => ID_PATTERN.test(id)).slice(0, 8) : [],
        leaseId: randomUUID(), leaseUntil: now() + LEASE_MS, updatedAt: new Date(now()).toISOString()
      };
      try {
        const saved = await write(recoveryScanPath, next, previous?.etag);
        claim = { state: next, etag: saved.etag, items: [] };
        break;
      } catch (error) { if (!storageConflict(error)) throw error; }
    }
    if (!claim) return null;
    try {
      if (claim.state.pendingIds.length) {
        claim.items = (await Promise.all(claim.state.pendingIds.map(loadRecord))).filter(Boolean);
        await updateRecoveryScan(claim, { pendingIds: claim.items.map((record) => record.id) });
        if (claim.items.length) return claim;
      }
      let result;
      try { result = await page({ cursor: claim.state.cursor, limit: batchLimit, outbox: true, maxScans: 1 }); }
      catch (error) {
        // A storage cursor may expire. Restart the cycle without removing any
        // retry marker; per-channel delivery claims still prevent duplicate sends.
        const invalidCursor = /(?:invalid|expired).*cursor|cursor.*(?:invalid|expired)/i.test(error?.message || '') || error?.status === 400;
        if (!claim.state.cursor || !invalidCursor) throw error;
        result = await page({ limit: batchLimit, outbox: true, maxScans: 1 });
      }
      if (!result.items.length && !result.cursor && claim.state.cursor) {
        // Deletions can invalidate the position of an otherwise valid cursor.
        // Start at the head once, rather than waste a whole scheduled run.
        result = await page({ limit: batchLimit, outbox: true, maxScans: 1 });
      }
      claim.items = result.items;
      // Persist both the next page and the unfinished work before any provider
      // call. A cold start or timeout continues the cycle instead of retrying
      // the same eight oldest failures forever.
      await updateRecoveryScan(claim, { cursor: result.cursor || null, pendingIds: claim.items.map((record) => record.id) });
      return claim;
    } catch (error) {
      await releaseRecoveryScan(claim).catch(() => {});
      throw error;
    }
  }

  async function takeRecoveryItems(claim, limit = 2) {
    const ids = claim.state.pendingIds.slice(0, Math.max(1, Math.min(8, limit)));
    if (!ids.length) return [];
    // Advance before attempting this small group. If the process is killed,
    // its markers remain in the outbox and are revisited on the next cycle;
    // the other groups still get their turn on the following scheduled run.
    await updateRecoveryScan(claim, { pendingIds: claim.state.pendingIds.slice(ids.length) });
    const byId = new Map(claim.items.map((record) => [record.id, record]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  }

  async function releaseRecoveryScan(claim) {
    if (!claim) return;
    try { await updateRecoveryScan(claim, { leaseId: '', leaseUntil: 0 }); }
    catch (error) { if (!storageConflict(error)) throw error; }
  }

  async function setStatus(id, status) {
    if (!['new', 'contacted', 'closed'].includes(status)) throw Object.assign(new Error('invalid_status'), { status: 400 });
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await read(idPath(id));
      if (!existing) return null;
      const record = { ...existing.value, status, updatedAt: new Date(now()).toISOString() };
      try { await write(idPath(id), record, existing.etag); return record; }
      catch (error) { if (!storageConflict(error)) throw error; }
    }
    throw Object.assign(new Error('record_conflict'), { status: 409 });
  }

  return { namespace, loadRecord, saveSubmission, notifications, claimDelivery, finishDelivery, ensureRecovery, settleOutbox, page, claimRecoveryScan, takeRecoveryItems, releaseRecoveryScan, setStatus };
}
