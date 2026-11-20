import { createHash, randomUUID } from 'node:crypto';
import { BlobError, get, head, put } from '@vercel/blob';
import sharp from 'sharp';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { validInstagramImageSource } from './instagram-image.js';

const ORIGIN = 'https://autovalorpt-assistente.vercel.app';
const ROOT = 'catalog-images/v1/production';
const ID = /^ID[A-Za-z0-9]{5,30}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_PIXELS = 20_000_000;
const JOB_STATES = ['processing', 'ready', 'unchanged', 'review_required', 'failed', 'unknown'];
const STORAGE_OPTIONS = { access: 'private', addRandomSuffix: false, cacheControlMaxAge: 60 };
const safeReason = (value, fallback) => /^[a-z][a-z0-9_]{2,79}$/.test(value || '') ? value : fallback;
export const catalogFailure = code => Object.assign(new Error(code), { code });
export const catalogHash = value => createHash('sha256').update(value).digest('hex');

export function catalogImageUrl(id, hash) {
  if (!ID.test(id || '') || !HASH.test(hash || '')) throw catalogFailure('catalog_image_invalid');
  return `${ORIGIN}/api/stock?integration=catalog-image&id=${id}&asset=${hash}`;
}

export function canonicalCatalogOriginal(value) {
  if (!validInstagramImageSource(value)) throw catalogFailure('catalog_image_source_invalid');
  const url = new URL(value);
  if (!/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/.test(url.pathname)) throw catalogFailure('catalog_image_source_invalid');
  url.pathname = url.pathname.replace(/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/, '/image');
  return url.href;
}

export async function readCatalogBlob(storage, path, maximum) {
  const result = await readInstagramBlob(storage, path);
  if (!result) return null;
  if (result.statusCode !== 200 || !result.blob?.etag || !result.stream) throw catalogFailure('catalog_storage_unavailable');
  const reader = result.stream.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > maximum) throw catalogFailure('catalog_storage_invalid');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { buffer: Buffer.concat(chunks), etag: result.blob.etag };
}

export async function readCatalogJson(storage, path, maximum = MAX_MANIFEST_BYTES) {
  const stored = await readCatalogBlob(storage, path, maximum);
  if (!stored) return null;
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.buffer)); }
  catch { throw catalogFailure('catalog_storage_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw catalogFailure('catalog_storage_invalid');
  return { value, etag: stored.etag };
}

export async function putCatalogImmutable(storage, path, input, contentType, maximum) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!buffer.length || buffer.length > maximum) throw catalogFailure('catalog_storage_invalid');
  const existing = await readCatalogBlob(storage, path, maximum);
  if (existing) {
    if (!existing.buffer.equals(buffer)) throw catalogFailure('catalog_immutable_conflict');
    return existing;
  }
  try {
    const result = await storage.put(path, buffer, { ...STORAGE_OPTIONS, allowOverwrite: false,
      contentType, abortSignal: AbortSignal.timeout(8000) });
    if (!result.etag) throw catalogFailure('catalog_storage_unavailable');
    return { buffer, etag: result.etag };
  } catch (error) {
    if (!instagramStorageConflict(error) && error?.constructor !== BlobError) throw error;
    const written = await readCatalogBlob(storage, path, maximum);
    if (!written) throw error;
    if (!written.buffer.equals(buffer)) throw catalogFailure('catalog_immutable_conflict');
    return written;
  }
}

function imageJobKey(binding) {
  return catalogHash(JSON.stringify(['catalog-image-v1', binding.id, binding.sourceId, binding.sourceUrl,
    binding.sourceHash, binding.backgroundVersion, binding.modelVersion]));
}

function checkedJob(value, key) {
  if (value.version !== 1 || !ID.test(value.id || '') || value.sourceId !== 'autovalorpt' ||
      !HASH.test(value.sourceHash || '') || typeof value.backgroundVersion !== 'string' || !value.backgroundVersion || value.backgroundVersion.length > 100 ||
      typeof value.modelVersion !== 'string' || !value.modelVersion || value.modelVersion.length > 100 ||
      !JOB_STATES.includes(value.status) || canonicalCatalogOriginal(value.sourceUrl) !== value.sourceUrl ||
      imageJobKey(value) !== key || value.jobKey !== key) throw catalogFailure('catalog_image_manifest_invalid');
  if (value.status === 'ready' && (!HASH.test(value.outputHash || '') || value.mimeType !== 'image/png' ||
      !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height) || value.width < 1 || value.height < 1 ||
      value.width * value.height > MAX_PIXELS)) throw catalogFailure('catalog_image_manifest_invalid');
  return value;
}

function publicBinding(job) {
  return Object.fromEntries(['id', 'sourceId', 'sourceUrl', 'sourceHash', 'jobKey', 'outputHash', 'backgroundVersion', 'modelVersion'].map(key => [key, job[key]]));
}

export function createCatalogImages(options = {}) {
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const preparePhoto = options.preparePhoto;
  const now = options.now || Date.now;
  const runtimeNow = options.runtimeNow || Date.now;
  const backgroundVersion = options.backgroundVersion || 'samucar-2026-11-v1';
  const modelVersion = options.modelVersion || 'u2netp-2020-ort-1.31.1-v1-vision1';
  const minNewPreparationMs = Number.isSafeInteger(options.minNewPreparationMs)
    ? Math.max(1, Math.min(85000, options.minNewPreparationMs)) : 30000;
  const jobPath = key => `${ROOT}/jobs/${key}.json`;
  const approvedPath = (id, hash) => `${ROOT}/approved/${id}/${hash}.json`;
  const assetPath = hash => `${ROOT}/assets/${hash}.png`;
  const timestamp = () => new Date(now()).toISOString();

  async function readJob(key) {
    if (!HASH.test(key || '')) throw catalogFailure('catalog_image_manifest_invalid');
    const record = await readCatalogJson(storage, jobPath(key));
    return record ? { job: checkedJob(record.value, key), etag: record.etag } : null;
  }

  async function original(source, timeoutMs) {
    const response = await fetchImpl(source, { method: 'GET', headers: { Accept: 'image/jpeg,image/png,image/webp' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(10000, timeoutMs))) });
    if (!response.ok || response.url && response.url !== source || !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw catalogFailure('catalog_image_source_unavailable');
    if (Number(response.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) { await response.body.cancel().catch(() => {}); throw catalogFailure('catalog_image_source_too_large'); }
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length; if (size > MAX_IMAGE_BYTES) throw catalogFailure('catalog_image_source_too_large');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    if (!size) throw catalogFailure('catalog_image_source_unavailable');
    return Buffer.concat(chunks);
  }

  async function checkedOutput(result) {
    if (!Buffer.isBuffer(result.buffer) || !result.buffer.length || result.buffer.length > MAX_IMAGE_BYTES ||
        result.mimeType && result.mimeType !== 'image/png') throw catalogFailure('catalog_image_output_invalid');
    const picture = sharp(result.buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false });
    const metadata = await picture.metadata();
    if (metadata.format !== 'png' || !metadata.width || !metadata.height || metadata.pages > 1 ||
        result.width !== undefined && result.width !== metadata.width || result.height !== undefined && result.height !== metadata.height) throw catalogFailure('catalog_image_output_invalid');
    await picture.stats(); // Decode once before approval; never rewrite the returned pixels.
    return { buffer: result.buffer, outputHash: catalogHash(result.buffer), mimeType: 'image/png', width: metadata.width, height: metadata.height };
  }

  async function approved(id, hash) {
    if (!ID.test(id || '') || !HASH.test(hash || '')) throw catalogFailure('catalog_image_invalid');
    const record = await readCatalogJson(storage, approvedPath(id, hash));
    if (!record) throw catalogFailure('catalog_image_not_found');
    const proof = record.value;
    if (proof.version !== 1 || proof.id !== id || proof.outputHash !== hash || !HASH.test(proof.jobKey || '')) throw catalogFailure('catalog_image_manifest_invalid');
    const current = await readJob(proof.jobKey);
    if (!current || current.job.status !== 'ready' || current.job.id !== id || current.job.outputHash !== hash) throw catalogFailure('catalog_image_manifest_invalid');
    return current.job;
  }

  async function image(id, hash) {
    const job = await approved(id, hash);
    const stored = await readCatalogBlob(storage, assetPath(hash), MAX_IMAGE_BYTES);
    if (!stored || catalogHash(stored.buffer) !== hash) throw catalogFailure('catalog_image_asset_invalid');
    return { buffer: stored.buffer, mimeType: 'image/png', width: job.width, height: job.height, hash };
  }

  async function ensureApproval(job) {
    const stored = await readCatalogBlob(storage, assetPath(job.outputHash), MAX_IMAGE_BYTES);
    if (!stored || catalogHash(stored.buffer) !== job.outputHash) throw catalogFailure('catalog_image_asset_invalid');
    const existing = await readCatalogJson(storage, approvedPath(job.id, job.outputHash));
    if (existing) { await approved(job.id, job.outputHash); return; }
    const proof = { version: 1, id: job.id, outputHash: job.outputHash, jobKey: job.jobKey };
    try {
      await putCatalogImmutable(storage, approvedPath(job.id, job.outputHash), JSON.stringify(proof), 'application/json', MAX_MANIFEST_BYTES);
    } catch (error) {
      // Equal output bytes from another verified recipe may already own this
      // id/hash URL; that permanent approval can be shared without overwriting.
      if (error?.code !== 'catalog_immutable_conflict') throw error;
      await approved(job.id, job.outputHash);
    }
  }

  async function resolveJob(job, item, writeApproval) {
    if (job.id !== item.id || job.sourceUrl !== canonicalCatalogOriginal(item.image_link)) throw catalogFailure('catalog_image_binding_invalid');
    if (job.status === 'ready') {
      if (writeApproval) await ensureApproval(job);
      else await approved(job.id, job.outputHash);
      return { imageUrl: catalogImageUrl(job.id, job.outputHash), binding: publicBinding(job),
        diagnostic: { id: item.id, status: 'prepared' }, attempted: false };
    }
    const status = ['processing', 'unknown'].includes(job.status) ? 'pending' : job.status;
    return { imageUrl: item.image_link, diagnostic: { id: item.id, status,
      reason: safeReason(job.reason, status === 'pending' ? 'catalog_image_processing_unconfirmed' : `catalog_image_${status}`) }, attempted: false };
  }

  async function verifyBinding(binding, item) {
    if (!binding || binding.id !== item.id || binding.sourceUrl !== canonicalCatalogOriginal(item.image_link)) throw catalogFailure('catalog_image_binding_invalid');
    const record = await readJob(binding.jobKey);
    if (!record || record.job.status !== 'ready' || JSON.stringify(publicBinding(record.job)) !== JSON.stringify(binding)) throw catalogFailure('catalog_image_binding_invalid');
    return resolveJob(record.job, item, false);
  }

  async function prepare(item, settings = {}) {
    let attempted = false;
    const started = runtimeNow();
    const allowance = Math.max(0, Math.min(85000, settings.remainingMs ?? 85000));
    const remaining = () => Math.max(0, allowance - (runtimeNow() - started));
    const fallback = (status, reason) => ({ imageUrl: item.image_link, diagnostic: { id: item.id, status, reason }, attempted });
    try {
      if (!ID.test(item.id || '')) throw catalogFailure('catalog_image_invalid');
      const sourceUrl = canonicalCatalogOriginal(item.image_link);
      if (remaining() < 1000) return fallback('pending', 'catalogue_image_budget');
      const originalBuffer = await original(sourceUrl, remaining());
      const binding = { id: item.id, sourceId: 'autovalorpt', sourceUrl, sourceHash: catalogHash(originalBuffer), backgroundVersion, modelVersion };
      const key = imageJobKey(binding); binding.jobKey = key;
      const previous = await readJob(key);
      if (previous) return await resolveJob(previous.job, item, true);
      if (settings.allowNew === false || remaining() < minNewPreparationMs) return fallback('pending', 'catalogue_image_budget');
      if (typeof preparePhoto !== 'function') return fallback('pending', 'catalog_image_processor_unavailable');
      const pending = { version: 1, ...binding, status: 'processing', claimId: randomUUID(), createdAt: timestamp(), updatedAt: timestamp() };
      let claim;
      try {
        claim = await storage.put(jobPath(key), JSON.stringify(pending), { ...STORAGE_OPTIONS, allowOverwrite: false,
          contentType: 'application/json', abortSignal: AbortSignal.timeout(8000) });
        if (!claim.etag) return fallback('pending', 'catalog_image_claim_unconfirmed');
      } catch (error) {
        // A failed claim can have committed remotely. Never call the processor
        // unless this invocation received the unique creation's strong ETag.
        const current = await readJob(key);
        if (current) return await resolveJob(current.job, item, true);
        return fallback('pending', 'catalog_image_claim_unconfirmed');
      }
      let completed; let output;
      attempted = true;
      const limit = Math.max(1, remaining()); const controller = new AbortController(); let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => preparePhoto({ originalBuffer, item: { ...item }, backgroundVersion, modelVersion,
            remainingMs: limit, signal: controller.signal })),
          new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(catalogFailure('catalog_image_processing_timeout')); }, limit); }),
        ]);
        if (result?.status === 'prepared') {
          output = await checkedOutput(result);
          await putCatalogImmutable(storage, assetPath(output.outputHash), output.buffer, 'image/png', MAX_IMAGE_BYTES);
          const { buffer: _buffer, ...metadata } = output;
          completed = { ...pending, ...metadata, status: 'ready', updatedAt: timestamp() };
        } else if (['unchanged', 'review_required'].includes(result?.status)) {
          completed = { ...pending, status: result.status, reason: safeReason(result.reason, `catalog_image_${result.status}`), updatedAt: timestamp() };
        } else throw catalogFailure('catalog_image_output_invalid');
      } catch (error) {
        completed = { ...pending, status: error?.code === 'catalog_image_processing_timeout' ? 'unknown' : 'failed',
          reason: safeReason(error?.code, 'catalog_image_prepare_failed'), updatedAt: timestamp() };
      } finally { clearTimeout(timer); }
      try {
        const saved = await storage.put(jobPath(key), JSON.stringify(completed), { ...STORAGE_OPTIONS, allowOverwrite: true,
          ifMatch: claim.etag, contentType: 'application/json', abortSignal: AbortSignal.timeout(8000) });
        if (!saved.etag) return fallback('pending', 'catalog_image_result_unconfirmed');
      } catch {
        return fallback('pending', 'catalog_image_result_unconfirmed');
      }
      const resolved = await resolveJob(completed, item, true);
      return { ...resolved, attempted };
    } catch (error) {
      return fallback('failed', safeReason(error?.code, 'catalog_image_unavailable'));
    }
  }

  return { prepare, verifyBinding, image, recipe: { backgroundVersion, modelVersion } };
}
