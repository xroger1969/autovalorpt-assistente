import { get, head, put } from '@vercel/blob';
import { createStockSource, stockFeedCsv, stockSnapshotUrl } from './stock-source.js';
import { parseInstagramFeed } from './instagram-publisher.js';
import { validateFeed } from './meta-catalog-source.js';
import { createCatalogImages, catalogFailure, catalogHash, catalogImageUrl,
  readCatalogBlob, readCatalogJson, putCatalogImmutable } from './catalog-images.js';

const ROOT = 'catalog-feed/v1/production';
const STATE = `${ROOT}/state.json`;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^ID[A-Za-z0-9]{5,30}$/;
const MAX_FEED = 2 * 1024 * 1024;
const MAX_METADATA = 4 * 1024 * 1024;
const STATUSES = ['prepared', 'unchanged', 'pending', 'review_required', 'failed'];
const safeCode = error => /^catalog_[a-z0-9_]{1,70}$/.test(error?.code || '') ? error.code : 'catalog_feed_unavailable';
const csvPath = hash => `${ROOT}/snapshots/${hash}.csv`;
const metadataPath = hash => `${ROOT}/snapshots/${hash}.json`;
const lineagePath = (hash, sourceHash, lineageHash) => `${ROOT}/lineages/${hash}/${sourceHash}/${lineageHash}.json`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sortedEntries = value => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));

function rows(raw) {
  if (raw?.valid !== true || !HASH.test(raw.feedHash || '') || !Array.isArray(raw.items) ||
      raw.items.length < 1 || raw.items.length > 2000 || raw.expectedCount !== raw.items.length || raw.sourceCount !== raw.items.length) throw catalogFailure('catalog_raw_source_invalid');
  const items = parseInstagramFeed(stockFeedCsv(raw.items)); validateFeed(items, 'catalog');
  if (catalogHash(stockFeedCsv(items)) !== raw.feedHash) throw catalogFailure('catalog_raw_source_invalid');
  return items;
}

function autoIds(raw, items) {
  const source = raw.sources?.find(value => value.id === 'autovalorpt');
  if (!source) return [];
  const live = new Set(items.map(item => item.id));
  if (!Array.isArray(source.ids) || source.count !== source.ids.length || new Set(source.ids).size !== source.ids.length ||
      source.ids.some(id => !ID.test(id) || !live.has(id))) throw catalogFailure('catalog_source_membership_invalid');
  return [...source.ids].sort((a, b) => a.localeCompare(b));
}

function diagnosticsChecked(value, ids) {
  if (!Array.isArray(value) || value.length !== ids.length || new Set(value.map(item => item?.id)).size !== ids.length ||
      value.some(item => !item || !ids.includes(item.id) || !STATUSES.includes(item.status) ||
        item.reason !== undefined && !/^[a-z][a-z0-9_]{2,79}$/.test(item.reason))) throw catalogFailure('catalog_diagnostics_invalid');
  return value.map(({ id, status, reason }) => ({ id, status, ...(reason ? { reason } : {}) }));
}

function summarize(raw, original, items, bindings, diagnostics, status) {
  const expectedImages = Object.fromEntries(items.map(item => [item.id, item.image_link]));
  const sourceOriginals = Object.fromEntries(original.map(item => [item.id, item.image_link]));
  const imageRevision = catalogHash(JSON.stringify(sortedEntries(expectedImages)));
  const feedHash = catalogHash(stockFeedCsv(items));
  const imageSummary = Object.fromEntries(STATUSES.map(name => [name, diagnostics.filter(item => item.status === name).length]));
  return { ...raw, valid: true, status, sourceFeedHash: raw.feedHash, items, feedHash,
    feedUrl: stockSnapshotUrl(feedHash), snapshotUrl: stockSnapshotUrl(feedHash), expectedImages, imageRevision,
    sourceOriginals, imageBindings: bindings, preparedIds: Object.keys(bindings).sort((a, b) => a.localeCompare(b)),
    imageDiagnostics: diagnostics, imageSummary };
}

export function createCatalogSource(options = {}) {
  const stockSource = options.stockSource || createStockSource(options);
  const storage = options.storage || { get, head, put };
  const images = createCatalogImages({ ...options, storage });
  const now = options.now || Date.now;
  const runtimeNow = options.runtimeNow || Date.now;
  const budgetMs = Number.isSafeInteger(options.prepareBudgetMs) ? Math.max(0, Math.min(85000, options.prepareBudgetMs)) : 85000;
  const maxNew = Number.isSafeInteger(options.maxNewPreparations) ? Math.max(0, Math.min(2, options.maxNewPreparations)) : 2;

  async function state() {
    const stored = await readCatalogJson(storage, STATE, MAX_METADATA);
    if (!stored) return null;
    const value = stored.value;
    if (value.version !== 1 || !['raw', 'prepared'].includes(value.mode) || !HASH.test(value.feedHash || '') ||
        !HASH.test(value.sourceFeedHash || '') || !HASH.test(value.imageRevision || '') || !Array.isArray(value.autoIds) ||
        value.autoIds.length > 2000 || value.autoIds.some(id => !ID.test(id)) || new Set(value.autoIds).size !== value.autoIds.length ||
        !value.recipe || !Number.isFinite(Date.parse(value.updatedAt))) throw catalogFailure('catalog_state_invalid');
    diagnosticsChecked(value.imageDiagnostics, value.autoIds);
    if (value.mode === 'raw' && value.feedHash !== value.sourceFeedHash) throw catalogFailure('catalog_state_invalid');
    if (value.lineageHash !== undefined && (value.mode !== 'prepared' || !HASH.test(value.lineageHash))) throw catalogFailure('catalog_state_invalid');
    return stored;
  }

  async function checkedSnapshot(fingerprint, buffer, value) {
    if (catalogHash(buffer) !== fingerprint) throw catalogFailure('catalog_snapshot_invalid');
    if (value.version !== 1 || value.feedHash !== fingerprint || !HASH.test(value.sourceFeedHash || '') ||
        !value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings) ||
        !Object.keys(value.bindings).length || Object.keys(value.bindings).length > 2000 || !Array.isArray(value.autoIds) ||
        value.autoIds.some(id => !ID.test(id)) || new Set(value.autoIds).size !== value.autoIds.length) throw catalogFailure('catalog_snapshot_invalid');
    const source = await stockSource.feed(value.sourceFeedHash);
    if (catalogHash(Buffer.from(source.csv)) !== value.sourceFeedHash) throw catalogFailure('catalog_snapshot_invalid');
    const original = parseInstagramFeed(source.csv); validateFeed(original, 'catalog');
    const byId = new Map(original.map(item => [item.id, item]));
    for (const [id, binding] of Object.entries(value.bindings)) {
      if (!byId.has(id) || !value.autoIds.includes(id) || binding?.id !== id) throw catalogFailure('catalog_snapshot_invalid');
      await images.verifyBinding(binding, byId.get(id));
    }
    const items = original.map(item => value.bindings[item.id] ? { ...item, image_link: catalogImageUrl(item.id, value.bindings[item.id].outputHash) } : item);
    const csv = stockFeedCsv(items);
    if (!buffer.equals(Buffer.from(csv))) throw catalogFailure('catalog_snapshot_invalid');
    return { csv, fingerprint, count: items.length, contentType: 'text/csv; charset=utf-8',
      metadata: value, original, items };
  }

  async function snapshot(fingerprint, lineage) {
    if (!HASH.test(fingerprint || '') || lineage && (!HASH.test(lineage.sourceFeedHash || '') || !HASH.test(lineage.lineageHash || ''))) throw catalogFailure('catalog_snapshot_invalid');
    const path = lineage ? lineagePath(fingerprint, lineage.sourceFeedHash, lineage.lineageHash) : metadataPath(fingerprint);
    const results = await Promise.allSettled([
      readCatalogBlob(storage, csvPath(fingerprint), MAX_FEED),
      readCatalogJson(storage, path, MAX_METADATA),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    const [csvRecord, metadata] = results.map(result => result.value);
    if (!csvRecord && !metadata && !lineage) throw catalogFailure('catalog_snapshot_not_found');
    if (!csvRecord || !metadata || lineage && (metadata.value.sourceFeedHash !== lineage.sourceFeedHash ||
        catalogHash(JSON.stringify(metadata.value)) !== lineage.lineageHash)) throw catalogFailure('catalog_snapshot_invalid');
    return checkedSnapshot(fingerprint, csvRecord.buffer, metadata.value);
  }

  async function feed(fingerprint) {
    let lineage;
    if (fingerprint === 'latest') {
      const current = await state();
      if (!current) throw catalogFailure('catalog_snapshot_not_found');
      if (current.value.mode === 'raw') return stockSource.feed(current.value.sourceFeedHash);
      fingerprint = current.value.feedHash;
      if (current.value.lineageHash) lineage = current.value;
    }
    const { metadata: _metadata, original: _original, items: _items, ...result } = await snapshot(fingerprint, lineage);
    return result;
  }

  async function saveSnapshot(csv, metadata) {
    // The visible CSV may stay identical while its original photograph, raw
    // snapshot or processing recipe changes. Bind each verified provenance
    // immutably, and leave the first public proof untouched for historical GETs.
    await checkedSnapshot(metadata.feedHash, Buffer.from(csv), metadata);
    const serialized = JSON.stringify(metadata); const lineageHash = catalogHash(serialized);
    await putCatalogImmutable(storage, csvPath(metadata.feedHash), csv, 'text/csv; charset=utf-8', MAX_FEED);
    await putCatalogImmutable(storage, lineagePath(metadata.feedHash, metadata.sourceFeedHash, lineageHash), serialized, 'application/json', MAX_METADATA);
    const existing = await readCatalogJson(storage, metadataPath(metadata.feedHash), MAX_METADATA);
    if (existing) {
      const checked = await snapshot(metadata.feedHash);
      if (checked.csv !== csv) throw catalogFailure('catalog_snapshot_invalid');
      return { metadata, lineageHash };
    }
    try {
      await putCatalogImmutable(storage, metadataPath(metadata.feedHash), serialized, 'application/json', MAX_METADATA);
    } catch (error) {
      if (error?.code !== 'catalog_immutable_conflict') throw error;
      const checked = await snapshot(metadata.feedHash);
      if (checked.csv !== csv) throw catalogFailure('catalog_snapshot_invalid');
    }
    return { metadata, lineageHash };
  }

  async function commit(previous, value) {
    try {
      const saved = await storage.put(STATE, JSON.stringify(value), { access: 'private', addRandomSuffix: false,
        cacheControlMaxAge: 60, contentType: 'application/json', allowOverwrite: Boolean(previous),
        ...(previous ? { ifMatch: previous.etag } : {}), abortSignal: AbortSignal.timeout(8000) });
      if (!saved.etag) throw catalogFailure('catalog_state_unavailable');
    } catch (error) {
      const current = await state();
      if (!current || current.value.feedHash !== value.feedHash || current.value.sourceFeedHash !== value.sourceFeedHash ||
          current.value.lineageHash !== value.lineageHash ||
          !same(current.value.recipe, value.recipe) || !same(current.value.imageDiagnostics, value.imageDiagnostics)) throw catalogFailure('catalog_prepare_conflict');
    }
  }

  async function prepare() {
    const deadline = runtimeNow() + budgetMs; let raw;
    try {
      raw = await stockSource.audit();
      if (raw?.valid !== true) return raw;
      const original = rows(raw); const eligible = autoIds(raw, original);
      const previous = await state(); const bindings = {}; const diagnostics = []; const items = [];
      let attempted = 0;
      for (const item of original) {
        if (!eligible.includes(item.id)) { items.push(item); continue; }
        const result = await images.prepare(item, { allowNew: attempted < maxNew, remainingMs: Math.max(0, deadline - runtimeNow()) });
        if (result.attempted) attempted++;
        if (result.binding) bindings[item.id] = result.binding;
        diagnostics.push(result.diagnostic);
        items.push({ ...item, image_link: result.imageUrl });
      }
      diagnosticsChecked(diagnostics, eligible);
      // Validate the factual source again after potentially long processing.
      const latest = await stockSource.audit();
      if (latest?.valid !== true || latest.feedHash !== raw.feedHash || !same(latest.sources, raw.sources)) return {
        ...(latest || raw), valid: false, status: 'source_waiting', reason: 'catalog_source_changed' };
      let result = summarize(latest, original, items, bindings, diagnostics, 'catalog_images_prepared');
      let lineageHash;
      if (Object.keys(bindings).length) {
        const saved = await saveSnapshot(stockFeedCsv(items), { version: 1, feedHash: result.feedHash,
          sourceFeedHash: raw.feedHash, bindings, autoIds: eligible });
        lineageHash = saved.lineageHash;
      }
      await commit(previous, { version: 1, mode: Object.keys(bindings).length ? 'prepared' : 'raw',
        feedHash: result.feedHash, sourceFeedHash: raw.feedHash, imageRevision: result.imageRevision,
        ...(lineageHash ? { lineageHash } : {}),
        autoIds: eligible, imageDiagnostics: diagnostics, recipe: images.recipe, updatedAt: new Date(now()).toISOString() });
      return result;
    } catch (error) {
      return { ...(raw || {}), valid: false, status: 'source_waiting', reason: safeCode(error) };
    }
  }

  async function audit(input = {}) {
    let raw;
    try {
      raw = await stockSource.audit(input);
      if (raw?.valid !== true) return raw;
      const original = rows(raw); const eligible = autoIds(raw, original); const current = await state();
      if (!current || current.value.sourceFeedHash !== raw.feedHash || !same(current.value.recipe, images.recipe) || !same(current.value.autoIds, eligible)) {
        return summarize(raw, original, original, {}, eligible.map(id => ({ id, status: 'pending', reason: 'catalog_image_prepare_pending' })), 'catalog_images_pending');
      }
      if (current.value.mode === 'raw') {
        const result = summarize(raw, original, original, {}, current.value.imageDiagnostics, 'source_matches');
        if (result.imageRevision !== current.value.imageRevision) throw catalogFailure('catalog_state_invalid');
        return result;
      }
      const saved = await snapshot(current.value.feedHash, current.value.lineageHash ? current.value : undefined);
      if (saved.metadata.sourceFeedHash !== raw.feedHash || !same(saved.metadata.autoIds, eligible)) throw catalogFailure('catalog_state_invalid');
      const result = summarize(raw, original, saved.items, saved.metadata.bindings, current.value.imageDiagnostics, 'source_matches');
      if (result.imageRevision !== current.value.imageRevision) throw catalogFailure('catalog_state_invalid');
      return result;
    } catch (error) {
      return { ...(raw || {}), valid: false, status: 'source_waiting', reason: safeCode(error) };
    }
  }

  return { prepare, audit, feed, image: images.image };
}
