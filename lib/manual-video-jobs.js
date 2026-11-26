import { randomUUID } from 'node:crypto';
import { get, head, list, put } from '@vercel/blob';
import { waitUntil } from '@vercel/functions';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';

const ID = /^ID[A-Za-z0-9]{5,30}$/;
const JOB = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const LEASE_MS = 300_000;
const REVIEW_MS = 2 * 3600_000;
const JOB_PREFIX = 'instagram/v1/production/manual-video-jobs/';
const RECOVERY_PAGE_SIZE = 12;
const RECOVERY_CURSOR = /^[!-~]{1,1024}$/;
const fail = code => Object.assign(new Error(code), { code });
const safeCode = (value, fallback = 'manual_video_job_failed') => /^[a-z_]{3,70}$/.test(value || '') ? value : fallback;
const conflict = error => instagramStorageConflict(error) || error?.code === 'blob_read_version_changed';

function previewValid(result, id) {
  return result?.ok === true && result.status === 'preview_ready' && result.id === id && HASH.test(result.fingerprint) &&
    typeof result.reviewToken === 'string' && result.reviewToken.length > 0 && result.reviewToken.length < 4096 &&
    typeof result.videoUrl === 'string' && result.videoUrl.length > 0 && result.videoUrl.length < 4096 &&
    typeof result.downloadUrl === 'string' && result.downloadUrl.length > 0 && result.downloadUrl.length < 4096;
}

// Each vehicle has one private, conditional claim. The request only reserves
// work; Vercel keeps the registered promise alive after the 202 response. A
// different instance can read its result without starting another render.
export function createManualVideoJobs(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, list, put };
  const now = options.now || Date.now;
  const background = options.waitUntil || waitUntil;
  const publisher = options.manualPublisher;
  const account = String(env.INSTAGRAM_USER_ID || '');
  const report = options.report || (entry => console.error('manual_video_job_failed', JSON.stringify(entry)));
  const path = id => `${JOB_PREFIX}${id}.json`;
  const timestamp = () => new Date(now()).toISOString();
  const live = state => state.status === 'preparing' && now() < state.leaseExpiresAt;
  const pending = state => ({ ok: true, status: 'preparing', id: state.id, jobId: state.jobId, startedAt: state.startedAt });
  const failed = (id, jobId, reason) => ({ ok: false, status: 'failed', id, jobId, reason });

  function check(id, jobId) {
    if (env.VERCEL_ENV !== 'production') throw fail('production_required');
    if (typeof id !== 'string' || !ID.test(id) || jobId !== undefined && (typeof jobId !== 'string' || !JOB.test(jobId))) {
      throw fail('manual_video_job_invalid');
    }
  }

  function log(state, error, stage) {
    // Never log private signed media links, review receipts or raw errors.
    try { report({ action: 'stories-manual-create', id: state.id, jobId: state.jobId, stage,
      error: safeCode(error?.code, 'manual_video_job_unavailable') }); } catch { /* Reporting must not reject background work. */ }
  }

  async function read(id, { snapshot = false } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const blob = snapshot ? await storage.get(path(id), {
          access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000),
        }) : await readInstagramBlob(storage, path(id));
        if (!blob) return null;
        if (blob.statusCode !== 200 || !snapshot && !blob.blob?.etag) throw fail('manual_video_job_unavailable');
        const text = await new Response(blob.stream).text();
        let state;
        try { if (text.length > 32_768) throw new Error(); state = JSON.parse(text); }
        catch { throw fail('manual_video_job_state_invalid'); }
        if (state?.version !== 1 || state.id !== id || !JOB.test(state.jobId) || typeof state.account !== 'string' ||
            !['preparing', 'preview_ready', 'failed'].includes(state.status) || !Number.isFinite(Date.parse(state.startedAt)) ||
            !Number.isSafeInteger(state.leaseExpiresAt) || state.leaseExpiresAt !== Date.parse(state.startedAt) + LEASE_MS ||
            state.status === 'preview_ready' && (!previewValid(state.result, id) || !Number.isSafeInteger(state.expiresAt)) ||
            state.status === 'failed' && !/^[a-z_]{3,70}$/.test(state.reason || '')) throw fail('manual_video_job_state_invalid');
        return { state, etag: blob.blob?.etag };
      } catch (error) {
        if (error?.code === 'blob_read_version_changed' && attempt < 2) continue;
        if (['manual_video_job_unavailable', 'manual_video_job_state_invalid'].includes(error?.code)) throw error;
        throw fail('manual_video_job_unavailable');
      }
    }
  }

  async function save(record) {
    try {
      const result = await storage.put(path(record.state.id), JSON.stringify(record.state), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
        ...(record.etag ? { ifMatch: record.etag } : {}), cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000),
      });
      if (!result.etag) throw fail('manual_video_job_unavailable');
      record.etag = result.etag;
    } catch (error) {
      if (conflict(error)) throw error;
      throw fail('manual_video_job_unavailable');
    }
  }

  async function markFailed(record, reason) {
    record.state = { ...record.state, status: 'failed', reason, completedAt: timestamp() };
    delete record.state.result;
    delete record.state.expiresAt;
    try { await save(record); }
    catch (error) {
      // A replaced claim belongs to the newer request. A storage outage leaves
      // a bounded lease: progress reports interruption after five minutes.
      if (!conflict(error)) log(record.state, error, 'save_failure');
    }
  }

  function expiresAt(result) {
    const expiries = [now() + REVIEW_MS];
    for (const value of [result.videoUrl, result.downloadUrl]) {
      try {
        const expiry = Number(new URL(value).searchParams.get('expires')) * 1000;
        if (Number.isSafeInteger(expiry) && expiry > 0) expiries.push(expiry);
      } catch { /* Preview validity and URL binding remain enforced by its producer and consumer. */ }
    }
    const reviewExpiry = Number(result.reviewToken.split('.')[1]);
    if (Number.isSafeInteger(reviewExpiry) && reviewExpiry > 0) expiries.push(reviewExpiry);
    return Math.min(...expiries);
  }

  async function execute(record) {
    try {
      if (!live(record.state)) throw fail('manual_video_job_interrupted');
      const result = await publisher.preview(record.state.id);
      if (!previewValid(result, record.state.id)) throw fail(safeCode(result?.reason, 'manual_video_job_failed'));
      if (!live(record.state)) throw fail('manual_video_job_interrupted');
      const expiry = expiresAt(result);
      if (expiry <= now()) throw fail('manual_video_job_expired');
      record.state = { ...record.state, status: 'preview_ready', completedAt: timestamp(), expiresAt: expiry, result };
      await save(record);
    } catch (error) {
      if (conflict(error)) return; // A newer explicit job owns this vehicle now.
      log(record.state, error, 'prepare');
      await markFailed(record, safeCode(error?.code));
    }
  }

  async function create(id) {
    check(id);
    const previous = await read(id);
    if (previous?.state.account === account && live(previous.state)) return pending(previous.state);
    const startedAt = timestamp();
    const record = { etag: previous?.etag || null, state: { version: 1, id, account, jobId: randomUUID(),
      status: 'preparing', startedAt, leaseExpiresAt: Date.parse(startedAt) + LEASE_MS } };
    try { await save(record); }
    catch (error) {
      if (!conflict(error)) throw error;
      const winner = await read(id);
      if (!winner || winner.state.account !== account) throw fail('manual_video_job_unavailable');
      // Even if the winner completed very quickly, the losing duplicate only
      // observes that job. A later, explicit create can request a fresh review.
      return pending(winner.state);
    }
    const receipt = pending(record.state);
    // Register before allowing work to begin. A failed waitUntil registration
    // cannot leave an untracked render running after the HTTP response.
    let launch;
    const permitted = new Promise(resolve => { launch = resolve; });
    const work = permitted.then(allowed => allowed ? execute(record) : undefined);
    try { background(work); }
    catch (error) {
      launch(false);
      log(record.state, error, 'schedule');
      await markFailed(record, 'manual_video_job_unavailable');
      throw fail('manual_video_job_unavailable');
    }
    launch(true);
    return receipt;
  }

  async function progress({ id, jobId } = {}) {
    check(id, jobId);
    if (jobId === undefined) throw fail('manual_video_job_invalid');
    const record = await read(id);
    if (!record || record.state.account !== account || record.state.jobId !== jobId) {
      return failed(id, jobId, 'manual_video_job_not_found');
    }
    const state = record.state;
    if (state.status === 'preparing') return live(state) ? pending(state) : failed(id, jobId, 'manual_video_job_interrupted');
    if (state.status === 'failed') return failed(id, jobId, state.reason);
    if (now() >= state.expiresAt) return failed(id, jobId, 'manual_video_job_expired');
    // No rendering, inventory lookup, mutation or Meta publishing on this path.
    return { ...state.result, jobId, startedAt: state.startedAt };
  }

  async function recover({ cursor } = {}) {
    if (env.VERCEL_ENV !== 'production') throw fail('production_required');
    if (!account) throw fail('manual_video_job_unavailable');
    if (cursor !== undefined && (typeof cursor !== 'string' || !RECOVERY_CURSOR.test(cursor))) {
      throw fail('manual_video_recovery_cursor_invalid');
    }
    let page;
    try {
      page = await storage.list({ prefix: JOB_PREFIX, limit: RECOVERY_PAGE_SIZE,
        ...(cursor ? { cursor } : {}), abortSignal: AbortSignal.timeout(8000) });
    } catch { throw fail('manual_video_job_unavailable'); }
    if (!Array.isArray(page?.blobs) || page.blobs.length > RECOVERY_PAGE_SIZE ||
        page.hasMore && (typeof page.cursor !== 'string' || !RECOVERY_CURSOR.test(page.cursor) || page.cursor === cursor)) {
      throw fail('manual_video_job_unavailable');
    }
    const ids = new Set();
    for (const blob of page.blobs) {
      const key = blob?.pathname;
      if (typeof key !== 'string' || !key.startsWith(JOB_PREFIX) || !key.endsWith('.json')) continue;
      const id = key.slice(JOB_PREFIX.length, -5);
      if (ID.test(id)) ids.add(id);
    }
    const records = await Promise.allSettled(Array.from(ids, id => read(id, { snapshot: true })));
    const items = [];
    let partial = false;
    for (const record of records) {
      if (record.status === 'rejected') { partial = true; continue; }
      const state = record.value?.state;
      if (state?.account !== account ||
          !(live(state) || state.status === 'preview_ready' && state.expiresAt > now())) continue;
      const { id, jobId, status, startedAt } = state;
      items.push({ id, jobId, status, startedAt });
    }
    return { ok: true, items, nextCursor: page.hasMore ? page.cursor : null, ...(partial ? { partial } : {}) };
  }

  return { create, progress, recover };
}
