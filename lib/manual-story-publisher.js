import { createHmac, timingSafeEqual } from 'node:crypto';
import { BlobError, get, head, put } from '@vercel/blob';
import { instagramStorageConflict, readInstagramBlob } from './instagram-storage.js';

const ID = /^ID[A-Za-z0-9]{5,30}$/;
const HASH = /^[a-f0-9]{64}$/;
const META_ID = /^\d{5,30}$/;
const CLOSED = new Set(['published', 'canceled', 'failed']);
const UNCERTAIN = new Set(['publishing', 'unknown']);
const PHASES = new Set(['creating', 'preparing', ...UNCERTAIN, ...CLOSED]);
// The account also publishes one morning stock photo, one Story and one daily editorial.
const SCHEDULED_SLOTS = 3;
const hasCapacity = quota => Number.isSafeInteger(quota?.total) && Number.isSafeInteger(quota?.usage) && quota.total - quota.usage > SCHEDULED_SLOTS;
const stockChanged = error => ['stock_changed_before_publication', 'story_vehicle_unavailable', 'story_preview_required', 'story_asset_invalid'].includes(error?.code);
const REVIEW_MS = 2 * 3600_000;
const LEASE_MS = 300_000;
const fail = code => Object.assign(new Error(code), { code });
const response = (id, status, fields = {}) => ({ ok: ['ready', 'published', 'preparing', 'busy'].includes(status),
  id, status, published: status === 'published' ? 1 : 0, ...fields });

export function createManualStoryPublisher(options) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const { videos } = options;
  const openProvider = options.openProvider || (() => options.provider);
  const now = options.now || Date.now;
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const account = String(env.INSTAGRAM_USER_ID || '');
  const enabled = () => env.INSTAGRAM_STORIES_ENABLED === 'true' && META_ID.test(account);
  const path = id => `instagram/v1/production/manual-stories/${id}.json`;
  function assertProduction() {
    if (env.VERCEL_ENV !== 'production') throw fail('production_required');
    if (String(env.ADMIN_SESSION_SECRET || '').length < 32) throw fail('video_signing_not_configured');
  }
  function mac(id, fingerprint, generation, expires) {
    return createHmac('sha256', env.ADMIN_SESSION_SECRET)
      .update(['autovalorpt:manual-story:v1', account, id, fingerprint, generation, expires].join('\n')).digest();
  }
  function receipt(id, fingerprint, generation) {
    const expires = now() + REVIEW_MS;
    const reviewToken = [generation, expires, mac(id, fingerprint, generation, expires).toString('base64url')].join('.');
    return { id, fingerprint, reviewToken };
  }
  function verify({ id, fingerprint, reviewToken }) {
    assertProduction();
    const parts = typeof reviewToken === 'string' && /^(\d{1,8})\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(reviewToken);
    if (!ID.test(id) || !HASH.test(fingerprint) || !parts) throw fail('story_manual_review_invalid');
    const generation = Number(parts[1]), expires = Number(parts[2]);
    const actual = Buffer.from(parts[3], 'base64url');
    if (generation < 1 || expires > now() + REVIEW_MS || !timingSafeEqual(actual, mac(id, fingerprint, generation, expires))) {
      throw fail('story_manual_review_invalid');
    }
    return { generation, expires };
  }
  async function read(id) {
    const blob = await readInstagramBlob(storage, path(id));
    if (!blob) return { etag: null, state: { version: 1, id, account, attempts: [] } };
    if (blob.statusCode !== 200 || !blob.blob?.etag) throw fail('story_manual_state_unavailable');
    const state = JSON.parse(await new Response(blob.stream).text());
    if (state?.version !== 1 || state.id !== id || state.account !== account || !Array.isArray(state.attempts) ||
        state.attempts.some(a => !a || !PHASES.has(a.phase) || !HASH.test(a.fingerprint) || !Number.isSafeInteger(a.at) ||
          (['preparing', 'publishing', 'unknown', 'published'].includes(a.phase) && !META_ID.test(a.containerId)))) {
      throw fail('story_manual_state_invalid');
    }
    return { state, etag: blob.blob.etag };
  }
  async function save(record) {
    const stored = await storage.put(path(record.state.id), JSON.stringify(record.state), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000),
    });
    if (!stored.etag) throw fail('story_manual_state_unavailable');
    record.etag = stored.etag;
  }
  function view(id, attempt) {
    if (!attempt) return response(id, 'ready');
    const { phase, reason, instagramMediaId } = attempt;
    let status = phase;
    if (UNCERTAIN.has(phase)) status = 'review_required';
    if (phase === 'creating') status = now() - attempt.at < LEASE_MS ? 'busy' : 'preparing';
    return response(id, status, { ...(reason ? { reason } : {}), ...(instagramMediaId ? { instagramMediaId } : {}) });
  }
  async function transition(record, attempt, phase, fields = {}) {
    Object.assign(attempt, { phase, at: now() }, fields);
    await save(record);
    return view(record.state.id, attempt);
  }
  async function preview(id) {
    assertProduction();
    if (!ID.test(id)) throw fail('story_manual_id_invalid');
    const asset = await videos.preview(id);
    if (!asset.ok || asset.status !== 'preview_ready') return asset;
    const { state } = await read(id);
    const last = state.attempts.at(-1);
    const pending = last && !CLOSED.has(last.phase);
    // Browsers reviewing the same generation share one durable publication.
    // Only a new preview after a terminal result can authorize a repeat.
    const reuse = pending && (last.fingerprint === asset.fingerprint || UNCERTAIN.has(last.phase));
    const generation = state.attempts.length + (reuse ? 0 : 1);
    const { reviewToken } = receipt(id, asset.fingerprint, generation);
    const pendingPublication = pending && UNCERTAIN.has(last.phase) ? receipt(id, last.fingerprint, generation) : null;
    const priorStatus = reuse ? view(id, last).status : 'ready';
    const previous = state.attempts.findLast(attempt => attempt.phase === 'published');
    return { ...asset, pendingPublication, previousPublishedAt: previous ? new Date(previous.at).toISOString() : null, reviewToken, publicationEnabled: enabled() && priorStatus !== 'review_required',
      publicationStatus: priorStatus };
  }
  function differentAsset(id, attempt) {
    return UNCERTAIN.has(attempt.phase) ? response(id, 'review_required', { reason: 'story_manual_other_video_pending' }) :
      response(id, 'canceled', { reason: 'story_manual_review_stale' });
  }
  async function reconcile(record, attempt) {
    // The stored, account-bound container is the sole source of recovery.
    // Absence, FINISHED, errors and elapsed time cannot disprove a publication.
    try {
      const provider = await openProvider();
      const remote = await provider.inspect(attempt.containerId, Date.now() + 12000);
      if (remote.status_code === 'PUBLISHED') return await transition(record, attempt, 'published', { reason: 'story_provider_confirmed' });
    } catch { /* The durable claim continues to block another media_publish. */ }
    return view(record.state.id, attempt);
  }
  async function status(input) {
    const { generation } = verify(input);
    const record = await read(input.id);
    const attempt = record.state.attempts[generation - 1];
    if (attempt && attempt.fingerprint !== input.fingerprint) return differentAsset(input.id, attempt);
    if (attempt && UNCERTAIN.has(attempt.phase)) return reconcile(record, attempt);
    return view(input.id, attempt);
  }
  async function publish(input) {
    const { id, fingerprint } = input;
    const { generation, expires } = verify(input);
    if (input.confirmed !== true) throw fail('story_manual_confirmation_required');
    const record = await read(id);
    const attempts = record.state.attempts;
    let attempt = attempts[generation - 1];
    if (attempt && attempt.fingerprint !== fingerprint) return differentAsset(id, attempt);
    if (attempt && UNCERTAIN.has(attempt.phase)) return reconcile(record, attempt);
    if (attempt && (CLOSED.has(attempt.phase) || view(id, attempt).status === 'busy')) return view(id, attempt);
    if (!enabled()) return response(id, 'disabled');
    if (expires <= now()) throw fail('story_manual_review_expired');
    const deadline = Date.now() + 225000;
    const provider = await openProvider();
    const auth = await provider.authorize(deadline);
    if (!auth.ready) return response(id, 'authorization_required', { reason: auth.reason });
    if (!hasCapacity(auth.publishingQuota)) return response(id, 'authorization_required', { reason: 'story_manual_quota_reserved' });
    try {
      if (!attempt || attempt.phase === 'creating') {
        let asset;
        try { asset = await videos.validate(id, fingerprint); }
        catch (error) {
          if (!stockChanged(error)) throw error;
          if (attempt) return await transition(record, attempt, 'canceled', { reason: error.code });
          return response(id, 'canceled', { reason: error.code });
        }
        if (!attempt) {
          const last = attempts.at(-1);
          if (generation !== attempts.length + 1 || last && UNCERTAIN.has(last.phase)) return response(id, 'review_required');
          // A different, freshly validated fingerprint supersedes an unpublished
          // container. The ETag prevents its previous caller from publishing it.
          if (last && !CLOSED.has(last.phase)) {
            if (last.fingerprint === fingerprint) return response(id, 'busy');
            Object.assign(last, { phase: 'canceled', at: now(), reason: 'stock_changed' });
          }
          attempt = { fingerprint, createdAt: now() };
          attempts.push(attempt);
        }
        await transition(record, attempt, 'creating');
        let container;
        try {
          container = await provider.create(asset.videoUrl, deadline);
          if (!META_ID.test(container.id)) throw fail('story_container_invalid');
        } catch (error) {
          // Creation can leave an unpublished container, never a public Story.
          return await transition(record, attempt, 'failed', { reason: error.code || 'story_container_failed' });
        }
        await transition(record, attempt, 'preparing', { containerId: String(container.id) });
      }
      let remote = await provider.inspect(attempt.containerId, deadline);
      for (let poll = 0; remote.status_code === 'IN_PROGRESS' && poll < (options.pollAttempts ?? 35) && Date.now() + 35000 < deadline; poll++) {
        await pause(2000);
        remote = await provider.inspect(attempt.containerId, deadline);
      }
      if (remote.status_code === 'IN_PROGRESS') return view(id, attempt);
      if (remote.status_code === 'PUBLISHED') return await transition(record, attempt, 'published', { reason: 'story_provider_confirmed' });
      if (remote.status_code !== 'FINISHED') return await transition(record, attempt, 'failed', { reason: 'story_container_not_ready' });
      try { await videos.validate(id, fingerprint); }
      catch (error) {
        if (!stockChanged(error)) throw error;
        return await transition(record, attempt, 'canceled', { reason: error.code });
      }
      if (!hasCapacity(await provider.quota(deadline))) return response(id, 'authorization_required', { reason: 'story_manual_quota_reserved' });
      if (expires <= now()) throw fail('story_manual_review_expired');
      await transition(record, attempt, 'publishing');
      let published;
      try {
        published = await provider.publish(attempt.containerId, deadline);
        if (!META_ID.test(published.id)) throw fail('story_publish_unknown');
      } catch (error) {
        return await transition(record, attempt, 'unknown', { reason: error.code || 'story_publish_unknown' });
      }
      return await transition(record, attempt, 'published', { instagramMediaId: String(published.id) });
    } catch (error) {
      if (instagramStorageConflict(error) || error?.code === 'blob_read_version_changed' ||
          error?.constructor === BlobError && /already exists|precondition/i.test(error.message)) return response(id, 'busy');
      throw error;
    }
  }
  return { preview, publish, status };
}
