import { createHash } from 'node:crypto';
import { fetchInstagramFeed } from './instagram-publisher.js';
import { STOCK_INVENTORIES } from './stock-inventories.js';
import { stockPhotoIdentity, originalPhotoGallery, additionalStockPhotos } from './stock-photos.js';

const SHEET = '1RENDbmN9Inyd2fr0FQJJmbe1jMpJl4Psevlawc92uVs';
export const META_CATALOG_SOURCE_URLS = Object.freeze({
  // Kept as the explicit identity of the legacy, Samucar-only seed/state.
  inventory: STOCK_INVENTORIES[0].url,
  catalog: `https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=1511112026`,
  stock: `https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv&gid=2105479537`,
});

const COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const MAX_INVENTORY_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 2000;
const ID = /^ID[A-Za-z0-9]{5,30}$/;
const fail = (code) => Object.assign(new Error(code), { code });
const normalize = (value) => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f<>]/.test(value);
const FEED_ERRORS = new Set(['feed_too_large', 'feed_unavailable', 'feed_truncated_csv', 'feed_malformed_csv', 'feed_invalid_headers_or_count', 'feed_incomplete_row', 'feed_invalid_item']);
const SOURCE_ERRORS = new Set([
  'source_unavailable', 'source_timeout', 'source_too_large', 'source_invalid_encoding', 'source_schema_changed',
  'source_empty_inventory', 'source_incomplete_inventory', 'source_ambiguous_inventory', 'source_invalid_vehicle',
  'source_duplicate_vehicle', 'source_suspicious_drop', 'source_invalid_previous_count', 'source_ids_mismatch',
  'source_price_mismatch', 'source_item_mismatch', 'feeds_mismatch', 'feed_redirect_not_allowed', 'feed_redirect_limit',
  'catalog_invalid_item', 'stock_invalid_item', 'source_conflicting_vehicle',
]);

function safeFailure(error) {
  if (SOURCE_ERRORS.has(error?.code) || /^(?:catalog|stock)_feed_/.test(error?.code || '') && FEED_ERRORS.has(error.code.replace(/^(?:catalog|stock)_/, ''))) return error.code;
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return 'source_timeout';
  return 'source_unavailable';
}

function advertId(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['standvirtual.com', 'www.standvirtual.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return null;
    return url.pathname.match(/^\/carros\/anuncio\/[^/]+-(ID[A-Za-z0-9]{5,30})\.html$/)?.[1] || null;
  } catch { return null; }
}

const imageIdentity = stockPhotoIdentity;

export async function readInventory(response, maxBytes) {
  if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw fail('source_unavailable');
  if (Number(response.headers.get('content-length') || 0) > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw fail('source_too_large');
  }
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.length;
      if (length > maxBytes) throw fail('source_too_large');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw fail('source_invalid_encoding'); }
}

function inventoryData(html, allowEmpty) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => /(?:^|\s)id\s*=\s*(["'])__NEXT_DATA__\1/i.test(match[1]));
  if (scripts.length !== 1) throw fail('source_schema_changed');
  let page;
  try { page = JSON.parse(scripts[0][2])?.props?.pageProps; }
  catch { throw fail('source_schema_changed'); }
  if (!page || !Number.isSafeInteger(page.numberOfActiveAdverts) || page.numberOfActiveAdverts < 0 || page.numberOfActiveAdverts > MAX_ITEMS || !page.urqlState || typeof page.urqlState !== 'object' || Array.isArray(page.urqlState)) throw fail('source_schema_changed');
  if (!page.numberOfActiveAdverts && !allowEmpty) throw fail('source_empty_inventory');
  const groups = []; let visited = 0;
  for (const entry of Object.values(page.urqlState)) {
    if (!entry || typeof entry !== 'object' || !Object.hasOwn(entry, 'data')) continue;
    let data;
    try { data = typeof entry.data === 'string' ? JSON.parse(entry.data) : entry.data; }
    catch { throw fail('source_schema_changed'); }
    const pending = [data];
    while (pending.length) {
      const value = pending.pop();
      if (++visited > 100_000) throw fail('source_schema_changed');
      if (!value || typeof value !== 'object') continue;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'publishedAds') groups.push(child);
        else if (child && typeof child === 'object') pending.push(child);
      }
    }
  }
  if (!groups.length) throw fail('source_schema_changed');
  for (const group of groups) {
    if (!group || !Array.isArray(group.ads) || !Number.isSafeInteger(group.total) || group.total !== page.numberOfActiveAdverts || group.ads.length !== page.numberOfActiveAdverts) throw fail('source_incomplete_inventory');
  }
  return { count: page.numberOfActiveAdverts, groups };
}

function sourceVehicle(advert, currentYear, withVideoDetails, publicListing, withPhotoGallery, withSelectionIdentity) {
  if (!advert || typeof advert !== 'object' || !validText(advert.title, 170) || !Array.isArray(advert.attributes) || !Array.isArray(advert.photos) || !advert.photos.length) throw fail('source_invalid_vehicle');
  const id = advertId(advert.url); const image = imageIdentity(advert.photos[0]);
  const price = advert.price;
  if (!id || !image || price?.currencyCode !== 'EUR' || !Number.isSafeInteger(price.grossMinorAmount) || price.grossMinorAmount <= 0 || price.grossMinorAmount > 999_999_999) throw fail('source_invalid_vehicle');
  const attributes = new Map();
  for (const attribute of advert.attributes) {
    if (!attribute || typeof attribute.key !== 'string' || attributes.has(attribute.key)) throw fail('source_invalid_vehicle');
    attributes.set(attribute.key, attribute);
  }
  const yearRaw = attributes.get('first_registration_year')?.value;
  const mileageRaw = attributes.get('mileage')?.value;
  const year = Number(yearRaw); const mileage = Number(mileageRaw);
  const brand = attributes.get('make')?.valueLabel;
  const fuel = attributes.get('fuel_type')?.valueLabel;
  if (!/^\d{4}$/.test(String(yearRaw)) || year < 1900 || year > currentYear || !/^\d{1,7}$/.test(String(mileageRaw)) || mileage > 3_000_000 || !validText(brand, 100) || !validText(fuel, 100) || attributes.get('new_used')?.value !== 'used') throw fail('source_invalid_vehicle');
  const item = { id, title: normalize(advert.title), year, mileage, brand: normalize(brand), fuel: normalize(fuel),
    price: `${(price.grossMinorAmount / 100).toFixed(2)} EUR`, link: advert.url, image };
  const plateAttribute = ['registration_number', 'registration_plate', 'license_plate', 'licence_plate', 'number_plate']
    .map(key => attributes.get(key)).find(Boolean);
  const plate = plateAttribute?.value ?? advert.registrationNumber ?? advert.registrationPlate;
  if (withSelectionIdentity) {
    const vin = attributes.get('vin')?.value ?? advert.vin;
    if (typeof vin === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin.trim())) item.vin = vin.trim().toUpperCase();
    if (typeof plate === 'string' && /^[A-Z0-9 .-]{3,16}$/i.test(plate.trim())) item.plate = plate.trim().toUpperCase();
  }
  if (publicListing) item.fuelCode = attributes.get('fuel_type')?.value;
  if (!withVideoDetails && !withPhotoGallery) return item;
  const photos = originalPhotoGallery(advert.photos, image);
  if (!photos) throw fail('source_invalid_vehicle');
  if (!withVideoDetails) return { ...item, photos };
  const model = attributes.get('model')?.valueLabel;
  return { ...item, photos: photos.slice(0, 5), model: validText(model, 100) ? normalize(model) : null,
    plate: typeof plate === 'string' && /^[A-Z0-9][A-Z0-9 .-]{1,14}[A-Z0-9]$/i.test(plate.trim()) &&
      !['YES', 'NO', 'TRUE', 'FALSE', 'SIM', 'NAO'].includes(plate.trim().toUpperCase()) ? plate.trim().toUpperCase() : null };
}

export function validatedInventory(html, currentYear, { withVideoDetails = false, publicListing = false, withPhotoGallery = false, withSelectionIdentity = false } = {}) {
  const data = inventoryData(html, withVideoDetails || publicListing); let items;
  for (const group of data.groups) {
    const candidates = group.ads.map((advert) => sourceVehicle(advert, currentYear, withVideoDetails, publicListing, withPhotoGallery, withSelectionIdentity)).sort((a, b) => a.id.localeCompare(b.id));
    if (new Set(candidates.map((item) => item.id)).size !== data.count) throw fail('source_duplicate_vehicle');
    if (items && JSON.stringify(items) !== JSON.stringify(candidates)) throw fail('source_ambiguous_inventory');
    items = candidates;
  }
  return { count: data.count, items };
}

export async function readStockInventories(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 30_000) : 15_000;
  const maxBytes = Number.isSafeInteger(options.maxInventoryBytes) && options.maxInventoryBytes > 0 ? Math.min(options.maxInventoryBytes, MAX_INVENTORY_BYTES) : MAX_INVENTORY_BYTES;
  const currentYear = new Date(now()).getUTCFullYear();
  const results = await Promise.allSettled(STOCK_INVENTORIES.map(async (source) => {
    try {
      const response = await fetchImpl(source.url, {
        method: 'GET', headers: { Accept: 'text/html' }, cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      });
      if (response.url && response.url !== source.url) {
        await response.body?.cancel().catch(() => {}); throw fail('source_unavailable');
      }
      // Synchronization requires a non-empty source. The manual viewer can
      // display a verified zero (count, total and actual ads must all agree).
      const inventory = validatedInventory(await readInventory(response, maxBytes), currentYear, options);
      return { ...inventory, source: { ...source, count: inventory.count, ids: inventory.items.map(item => item.id) } };
    } catch (error) {
      throw Object.assign(fail(safeFailure(error)), { sourceId: source.id });
    }
  }));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const byId = new Map();
  const sources = [];
  for (const { value } of results) {
    sources.push(value.source);
    for (const item of value.items) {
      const previous = byId.get(item.id);
      // The same listing may occur in both sources; a different listing ID is
      // always a distinct item, regardless of similar make/model/year/photos.
      if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw fail('source_conflicting_vehicle');
      if (!previous) byId.set(item.id, item);
    }
  }
  if (byId.size > MAX_ITEMS) throw fail('source_schema_changed');
  const items = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { count: items.length, items, sources };
}

export function validateFeed(items, kind) {
  for (const item of items) {
    if (COLUMNS.some((key) => typeof item[key] !== 'string' || !item[key]) || !validText(item.description, 5000) || !validText(item.brand, 100) || advertId(item.link) !== item.id || !imageIdentity(item.image_link) || item.condition !== 'used' || !['in stock', 'out of stock'].includes(item.availability) || kind === 'catalog' && item.availability !== 'in stock') throw fail(`${kind}_invalid_item`);
    if (additionalStockPhotos(item) === null) throw fail(`${kind}_invalid_item`);
  }
}

// Only an advert already found in one of the two authorised inventories may
// supply a gallery. Never search for a similar model or follow redirects.
export function validatedAdvertGallery(html, item, sources) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => /(?:^|\s)id\s*=\s*(["'])__NEXT_DATA__\1/i.test(match[1]));
  let page;
  try { if (scripts.length === 1) page = JSON.parse(scripts[0][2])?.props?.pageProps; } catch {}
  const advert = page?.advert;
  const price = Number(advert?.price?.value);
  const owners = sources.filter(source => source.ids.includes(item.id)).map(source => source.url);
  if (!advert || page.advertDetailsId !== item.id || advertId(advert.url) !== item.id || advert.url !== item.link ||
      advert.status !== 'ACTIVE' || normalize(advert.title) !== item.title || advert.price?.currency !== 'EUR' ||
      !Number.isFinite(price) || Math.round(price * 100) !== Math.round(Number(item.price.split(' ')[0]) * 100) ||
      !owners.includes(advert.seller?.sellerUrl) || !Array.isArray(advert.images?.photos)) throw fail('source_gallery_mismatch');
  const photos = originalPhotoGallery(advert.images.photos.map(photo => typeof photo === 'string' ? photo : photo?.url), item.image);
  if (!photos || !item.photos.every((photo, index) => photos[index] === photo)) throw fail('source_gallery_mismatch');
  return photos;
}

export async function readCompleteStockGalleries(inventory, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const maxBytes = options.maxInventoryBytes || MAX_INVENTORY_BYTES;
  const timeoutMs = Math.min(options.timeoutMs || 15000, 30000);
  const galleries = {}; let cursor = 0;
  const worker = async () => {
    while (cursor < inventory.items.length) {
      const item = inventory.items[cursor++];
      try {
        const response = await fetchImpl(item.link, { method: 'GET', headers: { Accept: 'text/html' },
          cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
        if (response.url && response.url !== item.link) { await response.body?.cancel().catch(() => {}); throw fail('source_gallery_mismatch'); }
        galleries[item.id] = validatedAdvertGallery(await readInventory(response, maxBytes), item, inventory.sources);
      } catch (error) {
        throw Object.assign(fail(error?.code === 'source_gallery_mismatch' ? error.code : 'source_gallery_unavailable'),
          { sourceId: inventory.sources.find(source => source.ids.includes(item.id))?.id });
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, inventory.items.length) }, worker));
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  return Object.fromEntries(inventory.items.map(item => [item.id, galleries[item.id]]));
}

function previousCount(options, input) {
  const values = [input.previousExpectedCount, input.lastExpectedCount, options.previousExpectedCount, options.lastExpectedCount].filter((value) => value !== undefined && value !== null);
  const ids = input.previousExpectedIds ?? options.previousExpectedIds;
  if (ids !== undefined && ids !== null) {
    if (!Array.isArray(ids) || ids.length > MAX_ITEMS || ids.some((id) => typeof id !== 'string' || !ID.test(id)) || new Set(ids).size !== ids.length) throw fail('source_invalid_previous_count');
    values.push(ids.length);
  }
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_ITEMS) || new Set(values).size > 1) throw fail('source_invalid_previous_count');
  return values[0] || 0;
}

function googleExportUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
      ([META_CATALOG_SOURCE_URLS.catalog, META_CATALOG_SOURCE_URLS.stock].includes(url.href) || /^doc-[a-z0-9-]+-sheets\.googleusercontent\.com$/.test(url.hostname) && url.pathname.startsWith('/export/'));
  } catch { return false; }
}

export function createMetaCatalogSource(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  // Public Sheets exports take two network round trips. Their single deadline
  // includes every redirect and the streamed body; all reads run in parallel.
  const timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0 ? Math.min(options.timeoutMs, 30_000) : 25_000;
  const inventoryTimeoutMs = Math.min(timeoutMs, 15_000);
  const maxBytes = Number.isSafeInteger(options.maxInventoryBytes) && options.maxInventoryBytes > 0 ? Math.min(options.maxInventoryBytes, MAX_INVENTORY_BYTES) : MAX_INVENTORY_BYTES;

  // The caller cannot choose URLs. Follow only bounded Google export redirects;
  // neither feed values nor HTTP input can select another network destination.
  async function feedFetch(initialUrl, init) {
    if (![META_CATALOG_SOURCE_URLS.catalog, META_CATALOG_SOURCE_URLS.stock].includes(initialUrl)) throw fail('feed_redirect_not_allowed');
    let url = initialUrl;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const response = await fetchImpl(url, { ...init, method: 'GET', cache: 'no-store', redirect: 'manual' });
      if (response.url && response.url !== url) {
        await response.body?.cancel().catch(() => {});
        throw fail('feed_redirect_not_allowed');
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      let next;
      try { next = new URL(location || '', url).href; } catch { throw fail('feed_redirect_not_allowed'); }
      if (!location || !googleExportUrl(next)) throw fail('feed_redirect_not_allowed');
      url = next;
    }
    throw fail('feed_redirect_limit');
  }

  async function feed(kind) {
    try { return await fetchInstagramFeed(META_CATALOG_SOURCE_URLS[kind], feedFetch, timeoutMs); }
    catch (error) {
      if (FEED_ERRORS.has(error?.code)) throw fail(`${kind}_${error.code}`);
      throw error;
    }
  }

  async function audit(input = {}) {
    const checkedAt = new Date(now()).toISOString(); let sourceCount; let expectedCount;
    try {
      const previous = previousCount(options, input);
      const results = await Promise.allSettled([
        readStockInventories({ fetchImpl, now, timeoutMs: inventoryTimeoutMs, maxInventoryBytes: maxBytes }),
        feed('catalog'), feed('stock'),
      ]);
      // Inspect the inventory first: an empty/partial montra must never be
      // disguised as a harmless empty export and must never authorize removal.
      if (results[0].status === 'fulfilled') sourceCount = results[0].value.count;
      if (results[1].status === 'fulfilled') expectedCount = results[1].value.length;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      const [source, catalog, stock] = results.map((result) => result.value);
      if (previous && sourceCount * 2 < previous) throw fail('source_suspicious_drop');
      validateFeed(catalog, 'catalog'); validateFeed(stock, 'stock');
      const byId = (a, b) => a.id.localeCompare(b.id);
      const items = [...catalog].sort(byId);
      const active = stock.filter((item) => item.availability === 'in stock').sort(byId);
      if (JSON.stringify(items.map((item) => COLUMNS.map((key) => item[key]))) !== JSON.stringify(active.map((item) => COLUMNS.map((key) => item[key])))) throw fail('feeds_mismatch');
      if (JSON.stringify(items.map((item) => item.id)) !== JSON.stringify(source.items.map((item) => item.id))) throw fail('source_ids_mismatch');
      for (let i = 0; i < items.length; i++) {
        const item = items[i]; const current = source.items[i];
        if (item.price !== current.price) throw fail('source_price_mismatch');
        const mileage = String(current.mileage).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
        const expectedTitle = `${current.title} | ${current.year} | ${mileage} km`;
        if (normalize(item.title) !== expectedTitle || normalize(item.brand) !== current.brand || item.link !== current.link || imageIdentity(item.image_link) !== current.image || !normalize(item.description).includes(current.fuel)) throw fail('source_item_mismatch');
      }
      const feedHash = createHash('sha256').update(JSON.stringify(items.map((item) => COLUMNS.map((key) => item[key])))).digest('hex');
      return { valid: true, expectedCount, sourceCount, checkedAt, feedHash, items, sources: source.sources,
        outOfStockIds: stock.filter(item => item.availability === 'out of stock').map(item => item.id).sort() };
    } catch (error) {
      return { valid: false, reason: safeFailure(error), checkedAt,
        ...(sourceCount !== undefined ? { sourceCount } : {}), ...(expectedCount !== undefined ? { expectedCount } : {}) };
    }
  }
  return { audit };
}

export async function auditMetaCatalogSource(options = {}) {
  return createMetaCatalogSource(options).audit(options);
}

