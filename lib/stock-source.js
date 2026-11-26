import { createHash } from 'node:crypto';
import { BlobError, get, head, put } from '@vercel/blob';
import { fetchInstagramFeed, parseInstagramFeed } from './instagram-publisher.js';
import { META_CATALOG_SOURCE_URLS, readStockInventories, readCompleteStockGalleries, validateFeed } from './meta-catalog-source.js';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { STOCK_INVENTORIES } from './stock-inventories.js';
import { originalPhotoGallery, additionalStockPhotos, MAX_CATALOG_ADDITIONAL_PHOTOS } from './stock-photos.js';

const ORIGIN = 'https://autovalorpt-assistente.vercel.app';
const ROOT = 'stock-source/v1/production';
const STATE_PATH = `${ROOT}/state.json`;
const COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const HASH = /^[a-f0-9]{64}$/;
const ID = /^ID[A-Za-z0-9]{5,30}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = value => new Date(value).toISOString();
const snapshotPath = fingerprint => `${ROOT}/snapshots/${fingerprint}.csv`;
const SOURCE_IDS = STOCK_INVENTORIES.map(source => source.id);
const reason = error => /^(?:stock_|source_|feed_|catalog_)[a-z_]{1,65}$/.test(error?.code || '') ? error.code :
  ['AbortError', 'TimeoutError'].includes(error?.name) ? 'source_timeout' : 'stock_source_unavailable';

export function stockSnapshotUrl(fingerprint) {
  if (!HASH.test(fingerprint || '')) throw fail('stock_snapshot_invalid');
  return `${ORIGIN}/api/stock?integration=stock-feed&snapshot=${fingerprint}`;
}

export function stockFeedCsv(items) {
  // Preserve legacy snapshot bytes exactly. New snapshots append the optional
  // gallery column without changing the original nine field meanings.
  const columns = items.some(item => Object.hasOwn(item, 'additional_image_link')) ? [...COLUMNS, 'additional_image_link'] : COLUMNS;
  return [columns, ...items.map(item => columns.map(key => item[key] ?? ''))]
    .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))
    .join('\r\n') + '\r\n';
}

export function stockFeedRow(item) {
  const mileage = String(item.mileage).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return { id: item.id, title: `${item.title} | ${item.year} | ${mileage} km`,
    description: `${item.title}. ${item.fuel}. ${item.year}. ${mileage} km.`,
    availability: 'in stock', condition: 'used', price: item.price, link: item.link,
    image_link: item.image, brand: item.brand,
    ...(item.photos ? { additional_image_link: item.photos.slice(1, MAX_CATALOG_ADDITIONAL_PHOTOS + 1).join(',') } : {}) };
}

function checkedGalleries(galleries, items) {
  const active = activeRows(items);
  if (!galleries || typeof galleries !== 'object' || Array.isArray(galleries) || Object.keys(galleries).length !== active.length)
    throw fail('stock_gallery_invalid');
  return Object.fromEntries(active.map(item => {
    const photos = originalPhotoGallery(galleries[item.id], item.image_link);
    if (!photos || JSON.stringify(photos) !== JSON.stringify(galleries[item.id]) ||
        JSON.stringify(photos.slice(1, MAX_CATALOG_ADDITIONAL_PHOTOS + 1)) !== JSON.stringify(additionalStockPhotos(item)))
      throw fail('stock_gallery_invalid');
    return [item.id, photos];
  }));
}

const galleryHash = galleries => hash(JSON.stringify(Object.entries(galleries).sort(([a], [b]) => a.localeCompare(b))));

function activeRows(items) { return items.filter(item => item.availability === 'in stock').sort((a, b) => a.id.localeCompare(b.id)); }

function legacyProvenance(items) {
  const ids = activeRows(items).map(item => item.id);
  return { sources: [{ ...STOCK_INVENTORIES[0], count: ids.length, ids }],
    itemSources: Object.fromEntries(items.map(item => [item.id, ['samucar']])) };
}

function checkedProvenance(state, items) {
  if (!Array.isArray(state.sources) || state.sources.length !== STOCK_INVENTORIES.length ||
      !state.itemSources || typeof state.itemSources !== 'object' || Array.isArray(state.itemSources) ||
      Object.keys(state.itemSources).length !== items.length) throw fail('stock_state_invalid');
  const byId = new Map(items.map(item => [item.id, item]));
  for (const [id, sources] of Object.entries(state.itemSources)) {
    if (!byId.has(id) || !Array.isArray(sources) || !sources.length || new Set(sources).size !== sources.length ||
        sources.some(source => !SOURCE_IDS.includes(source))) throw fail('stock_state_invalid');
  }
  const active = new Set();
  const sources = STOCK_INVENTORIES.map((definition, index) => {
    const source = state.sources[index];
    if (!source || source.id !== definition.id || source.name !== definition.name || source.url !== definition.url ||
        !Array.isArray(source.ids) || !Number.isSafeInteger(source.count) || source.count < 1 || source.count > 2000 ||
        source.count !== source.ids.length || new Set(source.ids).size !== source.ids.length) throw fail('stock_state_invalid');
    for (const id of source.ids) {
      if (byId.get(id)?.availability !== 'in stock' || !state.itemSources[id]?.includes(source.id)) throw fail('stock_state_invalid');
      active.add(id);
    }
    return { ...definition, count: source.count, ids: [...source.ids].sort((a, b) => a.localeCompare(b)) };
  });
  if (active.size !== activeRows(items).length) throw fail('stock_state_invalid');
  return { sources, itemSources: Object.fromEntries(items.map(item =>
    [item.id, SOURCE_IDS.filter(id => state.itemSources[item.id].includes(id))])) };
}

function checkDrops(current, historical, previous, state) {
  const priorSources = state?.sources || legacyProvenance(historical).sources;
  // A v1 state and the original Sheet describe Samucar only. Check that source
  // before adding AutoValorPT, whose new cars must not conceal a Samucar outage.
  for (const source of current.sources) {
    let prior = priorSources.find(value => value.id === source.id)?.count || 0;
    if ((!state || state.version === 1) && source.id === 'samucar') prior = Math.max(prior, previous);
    if (source.count * 2 < prior) throw Object.assign(fail('source_suspicious_drop'), { sourceId: source.id });
  }
  if (current.count * 2 < Math.max(previous, activeRows(historical).length)) throw fail('source_suspicious_drop');
}

function mergedProvenance(previous, current, items) {
  const itemSources = Object.fromEntries(items.map(item => [item.id, new Set(previous[item.id] || [])]));
  for (const source of current.sources) for (const id of source.ids) itemSources[id].add(source.id);
  return Object.fromEntries(items.map(item => [item.id, SOURCE_IDS.filter(id => itemSources[item.id].has(id))]));
}

function checkedItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 2000) throw fail('stock_state_invalid');
  if (items.some(item => !item || typeof item !== 'object' || COLUMNS.some(key => typeof item[key] !== 'string'))) throw fail('stock_state_invalid');
  validateFeed(items, 'stock');
  // Round-trip through the existing strict CSV parser as well as the stricter
  // catalogue validation: inherited historical rows receive the same scrutiny.
  const parsed = parseInstagramFeed(stockFeedCsv(items));
  validateFeed(parsed, 'stock');
  return parsed;
}

function expectedCount(input) {
  const count = input.previousExpectedCount;
  const ids = input.previousExpectedIds;
  if (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count < 0 || count > 2000)) throw fail('source_invalid_previous_count');
  if (ids !== undefined && ids !== null && (!Array.isArray(ids) || ids.length > 2000 || ids.some(id => !ID.test(id)) || new Set(ids).size !== ids.length)) throw fail('source_invalid_previous_count');
  if (count != null && ids != null && count !== ids.length) throw fail('source_invalid_previous_count');
  return count ?? ids?.length ?? 0;
}

export function createStockSource(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const production = () => { if (env.VERCEL_ENV !== 'production') throw fail('stock_production_required'); };
  const storageOptions = { access: 'private', addRandomSuffix: false, cacheControlMaxAge: 60 };

  async function readText(path, maximum) {
    const blob = await readInstagramBlob(storage, path);
    if (!blob) return null;
    if (blob.statusCode !== 200 || !blob.blob?.etag || !blob.stream) throw fail('stock_state_unavailable');
    const reader = blob.stream.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > maximum) throw fail('stock_state_invalid');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const content = Buffer.concat(chunks); let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); }
    catch { throw fail('stock_state_invalid'); }
    return { text, etag: blob.blob.etag, byteHash: hash(content) };
  }

  async function read() {
    const stored = await readText(STATE_PATH, MAX_BYTES);
    if (!stored) return null;
    let state;
    try { state = JSON.parse(stored.text); } catch { throw fail('stock_state_invalid'); }
    if (!state || typeof state !== 'object' || Array.isArray(state) || ![1, 2, 3].includes(state.version) ||
        (state.version === 1 && state.inventoryUrl !== META_CATALOG_SOURCE_URLS.inventory) ||
        state.seedUrl !== META_CATALOG_SOURCE_URLS.stock || !HASH.test(state.feedHash || '') ||
        !Number.isFinite(Date.parse(state.checkedAt)) || !Number.isFinite(Date.parse(state.initializedAt))) throw fail('stock_state_invalid');
    const items = checkedItems(state.items);
    const active = activeRows(items);
    if (!active.length || state.sourceCount !== active.length || hash(stockFeedCsv(active)) !== state.feedHash) throw fail('stock_state_invalid');
    const provenance = state.version === 1 ? legacyProvenance(items) : checkedProvenance(state, items);
    let galleries;
    if (state.version === 3) {
      galleries = checkedGalleries(state.galleries, items);
      if (!HASH.test(state.galleryRevision || '') || galleryHash(galleries) !== state.galleryRevision) throw fail('stock_gallery_invalid');
    }
    return { state: { ...state, ...provenance, items, ...(galleries ? { galleries } : {}) }, etag: stored.etag };
  }

  async function inventory() {
    const result = await readStockInventories({ fetchImpl, now, timeoutMs: 15000, maxInventoryBytes: MAX_BYTES, withPhotoGallery: true });
    const galleries = await readCompleteStockGalleries(result, { fetchImpl, timeoutMs: 15000, maxInventoryBytes: MAX_BYTES });
    const items = checkedItems(result.items.map(item => stockFeedRow({ ...item, photos: galleries[item.id] })));
    return { count: result.count, items, sources: result.sources, galleries: checkedGalleries(galleries, items) };
  }

  async function seed() {
    // Only the first sync uses the pre-existing public historical sheet. A
    // missing/invalid seed is never replaced with an empty publication baseline.
    const initial = META_CATALOG_SOURCE_URLS.stock;
    const seedFetch = async (url, init) => {
      if (url !== initial) throw fail('feed_redirect_not_allowed');
      let target = initial;
      for (let redirects = 0; redirects <= 4; redirects++) {
        const response = await fetchImpl(target, { ...init, method: 'GET', cache: 'no-store', redirect: 'manual' });
        if (response.url && response.url !== target) {
          await response.body?.cancel().catch(() => {}); throw fail('feed_redirect_not_allowed');
        }
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => {});
        let next;
        try { next = new URL(location || '', target); } catch { throw fail('feed_redirect_not_allowed'); }
        if (!location || next.protocol !== 'https:' || next.username || next.password || next.port || next.hash ||
            !(next.href === initial || /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(next.hostname) && next.pathname.startsWith('/export/'))) throw fail('feed_redirect_not_allowed');
        target = next.href;
      }
      throw fail('feed_redirect_limit');
    };
    return checkedItems(await fetchInstagramFeed(initial, seedFetch, 25000));
  }

  function summary(state) {
    const items = activeRows(state.items);
    return { valid: true, status: 'source_matches', sourceCount: items.length, expectedCount: items.length,
      checkedAt: state.checkedAt, feedHash: state.feedHash, feedUrl: stockSnapshotUrl(state.feedHash),
      snapshotUrl: stockSnapshotUrl(state.feedHash), items, sources: state.sources,
      outOfStockIds: state.items.filter(item => item.availability === 'out of stock').map(item => item.id).sort() };
  }

  async function feed(fingerprint) {
    production();
    let checkedAt; let galleries; let galleryRevision;
    // The stable catalogue URL resolves only the last committed snapshot.
    // It never refreshes inventory or mutates state on a public GET.
    if (fingerprint === 'latest') {
      const record = await read();
      if (!record) throw fail('stock_not_synchronized');
      fingerprint = record.state.feedHash;
      checkedAt = record.state.checkedAt;
      if (record.state.version === 3) {
        galleries = record.state.galleries;
        galleryRevision = record.state.galleryRevision;
      }
    }
    if (!HASH.test(fingerprint || '')) throw fail('stock_snapshot_invalid');
    const stored = await readText(snapshotPath(fingerprint), MAX_FEED_BYTES);
    if (!stored) throw fail('stock_snapshot_not_found');
    if (stored.byteHash !== fingerprint || hash(stored.text) !== fingerprint) throw fail('stock_snapshot_invalid');
    const items = parseInstagramFeed(stored.text); validateFeed(items, 'catalog');
    return { csv: stored.text, fingerprint, count: items.length, contentType: 'text/csv; charset=utf-8',
      ...(checkedAt ? { checkedAt } : {}), ...(galleries ? { galleries, galleryRevision } : {}) };
  }

  async function matchingSnapshot(csv, fingerprint) {
    try {
      if ((await feed(fingerprint)).csv !== csv) throw fail('stock_snapshot_invalid');
      return true;
    } catch (error) {
      // Only a confirmed absence permits creation. Failed, stale or corrupt
      // reads must never authorize a write over an existing immutable object.
      if (error?.code === 'stock_snapshot_not_found') return false;
      throw error;
    }
  }

  async function saveSnapshot(csv, fingerprint) {
    if (await matchingSnapshot(csv, fingerprint)) return;
    try {
      await storage.put(snapshotPath(fingerprint), csv, { ...storageOptions, allowOverwrite: false,
        contentType: 'text/csv; charset=utf-8', abortSignal: AbortSignal.timeout(8000) });
    } catch (error) {
      // SDK 2.6.1 can return a plain BlobError for a duplicate PUT, without a
      // conflict status/name. It is not proof that the snapshot exists: accept
      // that race only after an independent, byte-verified read of the same CSV.
      if (!instagramStorageConflict(error) && error?.constructor !== BlobError) throw error;
      if (!await matchingSnapshot(csv, fingerprint)) throw error;
    }
  }

  async function sync(input = {}) {
    const checkedAt = timestamp(now());
    try {
      production(); const previous = expectedCount(input);
      const record = await read();
      const results = await Promise.allSettled([inventory(), record ? Promise.resolve(record.state.items) : seed()]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const current = results[0].value; const historical = results[1].value;
      checkDrops(current, historical, previous, record?.state);
      const live = new Map(current.items.map(item => [item.id, item]));
      const priorIds = new Set(historical.map(item => item.id));
      const items = checkedItems([
        ...historical.map(item => live.get(item.id) || { ...item, availability: 'out of stock' }),
        ...current.items.filter(item => !priorIds.has(item.id))
      ]);
      const csv = stockFeedCsv(activeRows(items)); const fingerprint = hash(csv);
      const provenance = record?.state.itemSources || legacyProvenance(historical).itemSources;
      const state = { version: 3, seedUrl: META_CATALOG_SOURCE_URLS.stock, sources: current.sources,
        itemSources: mergedProvenance(provenance, current, items),
        galleries: current.galleries, galleryRevision: galleryHash(current.galleries),
        initializedAt: record?.state.initializedAt || checkedAt, checkedAt, sourceCount: current.count, feedHash: fingerprint, items };
      checkedProvenance(state, items);
      // The complete gallery is larger than the Meta CSV. Refuse an unreadable
      // state before either write, preserving the last usable catalogue.
      const serializedState = JSON.stringify(state);
      if (Buffer.byteLength(serializedState) > MAX_BYTES) throw fail('stock_state_too_large');
      await saveSnapshot(csv, fingerprint);
      try {
        const saved = await storage.put(STATE_PATH, serializedState, { ...storageOptions,
          allowOverwrite: Boolean(record), ...(record ? { ifMatch: record.etag } : {}),
          contentType: 'application/json', abortSignal: AbortSignal.timeout(8000) });
        if (!saved.etag) throw fail('stock_state_unavailable');
      } catch (error) {
        if (instagramStorageConflict(error)) throw fail('source_sync_conflict');
        throw error;
      }
      return { ...summary(state), status: 'source_synced' };
    } catch (error) { return { valid: false, status: 'source_waiting', reason: reason(error), checkedAt,
      ...(SOURCE_IDS.includes(error?.sourceId) ? { sourceId: error.sourceId } : {}) }; }
  }

  async function inspected(input = {}) {
    production(); const previous = expectedCount(input);
    const record = await read();
    if (!record) throw fail('stock_not_synchronized');
    const current = await inventory();
    checkDrops(current, record.state.items, previous, record.state);
    const fingerprint = hash(stockFeedCsv(activeRows(current.items)));
    if (fingerprint !== record.state.feedHash || record.state.version !== 3 || galleryHash(current.galleries) !== record.state.galleryRevision ||
        JSON.stringify(current.sources) !== JSON.stringify(record.state.sources)) throw fail('stock_source_changed');
    await feed(fingerprint);
    return { ...record.state, checkedAt: timestamp(now()) };
  }

  async function audit(input = {}) {
    try { return summary(await inspected(input)); }
    catch (error) { return { valid: false, status: 'source_waiting', reason: reason(error), checkedAt: timestamp(now()),
      ...(SOURCE_IDS.includes(error?.sourceId) ? { sourceId: error.sourceId } : {}) }; }
  }

  async function loadFeed() { return (await inspected()).items; }

  return { sync, audit, loadFeed, feed };
}
