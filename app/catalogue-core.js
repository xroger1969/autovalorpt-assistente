// Shared, dependency-free catalogue logic. Nothing in this module starts a
// synchronisation, sends a message or reads a private management endpoint.
const VEHICLE_ID = /^ID[A-Za-z0-9]{5,30}$/;
const REVISION = /^[a-f0-9]{64}$/;
const PRODUCTION_ORIGIN = 'https://autovalorpt-assistente.vercel.app';
const WHATSAPP_NUMBER = '351965637736';
const MAX_VEHICLES = 2000;
const MAX_IMAGES = 100;
export const FAVORITES_KEY = 'autovalor.catalogue.favorites.v1';

const currency = new Intl.NumberFormat('pt-PT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const collator = new Intl.Collator('pt-PT', { sensitivity: 'base', numeric: true });
const fold = value => typeof value === 'string'
  ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
  : '';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidInventory = () => new Error('Não foi possível confirmar o catálogo recebido.');

function text(value, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f<>]/.test(value)) {
    throw invalidInventory();
  }
  const result = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!allowEmpty && !result) throw invalidInventory();
  return result;
}

function timestamp(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw invalidInventory();
  }
  const datePart = value.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00Z`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== datePart) throw invalidInventory();
  return new Date(millis).toISOString();
}

function publicUrl(value, kind, id) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) throw invalidInventory();
  let url;
  try { url = new URL(value); } catch { throw invalidInventory(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    throw invalidInventory();
  }
  if (kind === 'advert') {
    const match = url.pathname.match(/^\/carros\/anuncio\/[^/]+-(ID[A-Za-z0-9]{5,30})\.html$/);
    if (!['www.standvirtual.com', 'standvirtual.com'].includes(url.hostname) || match?.[1] !== id) {
      throw invalidInventory();
    }
  } else if (url.hostname !== 'ireland.apollo.olxcdn.com' ||
      !/^\/v1\/files\/[^/]+\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/.test(url.pathname)) {
    throw invalidInventory();
  }
  return value;
}

function originalImages(image, images) {
  // Saved snapshots from before galleries contained only the cover. Keep them
  // usable offline, while validating every URL in a newly supplied gallery.
  if (images === undefined) return [image];
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) throw invalidInventory();
  const gallery = [...new Set(images.map(url => publicUrl(url, 'image')))];
  if (gallery[0] !== image) throw invalidInventory();
  return gallery;
}

/**
 * Validate an entire authoritative snapshot before replacing the visible one.
 * A bad row, duplicate ID or count mismatch invalidates the whole response;
 * none can silently become an empty or partial catalogue.
 */
export function normalizeInventory(payload) {
  if (!record(payload) || payload.ok !== true || !REVISION.test(payload.revision || '') ||
      !Array.isArray(payload.items) || !Number.isSafeInteger(payload.total) ||
      payload.total < 0 || payload.total > MAX_VEHICLES || payload.total !== payload.items.length) {
    throw invalidInventory();
  }
  const updatedAt = timestamp(payload.updatedAt);
  const ids = new Set();
  const maximumYear = new Date().getUTCFullYear() + 1;
  const items = payload.items.map(item => {
    if (!record(item) || typeof item.id !== 'string' || !VEHICLE_ID.test(item.id) || ids.has(item.id) ||
        typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || item.price > 9_999_999.99 ||
        !(item.year === null || Number.isSafeInteger(item.year) && item.year >= 1900 && item.year <= maximumYear) ||
        !(item.mileage === null || Number.isSafeInteger(item.mileage) && item.mileage >= 0 && item.mileage <= 3_000_000)) {
      throw invalidInventory();
    }
    ids.add(item.id);
    const image = publicUrl(item.image, 'image');
    // Explicit projection keeps unrelated/private fields out of browser storage.
    return {
      id: item.id,
      title: text(item.title, 500),
      brand: text(item.brand, 100),
      year: item.year,
      mileage: item.mileage,
      price: item.price,
      fuel: text(item.fuel, 100, true),
      image,
      images: originalImages(image, item.images),
      url: publicUrl(item.url, 'advert', item.id),
    };
  });
  return { updatedAt, revision: payload.revision, items };
}

export function fuelCategory(fuel) {
  const label = fold(fuel);
  const hasElectric = /\b(?:eletric[oa]s?|electric(?:[oa]s?)?|bev)\b/.test(label);
  const hasPetrol = /\b(?:gasolina|gasoline|petrol|benzina)\b/.test(label);
  const hasDiesel = /\b(?:gasoleo|diesel)\b/.test(label);
  // A hybrid may mention electricity, petrol and diesel. Check it first.
  if (/\b(?:hibrid\w*|hybrid\w*|phev|mhev|hev)\b|\bplug[\s-]?in\b/.test(label) ||
      hasElectric && (hasPetrol || hasDiesel)) return 'hybrid';
  if (hasElectric) return 'electric';
  if (hasDiesel) return 'diesel';
  if (hasPetrol) return 'petrol';
  return 'other';
}

export function filterVehicles(items, {
  query = '', fuel = 'all', brand = 'all', maxPrice = null,
  sort = 'price-asc', favoritesOnly = false, favoriteIds = [],
} = {}) {
  const words = fold(query).split(' ').filter(Boolean);
  const wantedBrand = fold(brand);
  const favorites = new Set(favoriteIds);
  const limit = maxPrice === null || maxPrice === '' ? null : Number(maxPrice);
  const filtered = items.filter(item => {
    if (fuel !== 'all' && fuelCategory(item.fuel) !== fuel) return false;
    if (wantedBrand && wantedBrand !== 'all' && fold(item.brand) !== wantedBrand) return false;
    if (limit !== null && Number.isFinite(limit) && item.price > limit) return false;
    if (favoritesOnly && !favorites.has(item.id)) return false;
    const searchable = fold(`${item.title} ${item.brand} ${item.fuel} ${item.year ?? ''} ${item.id}`);
    return words.every(word => searchable.includes(word));
  });
  const compareTitle = (a, b) => collator.compare(a.title, b.title) || collator.compare(a.id, b.id);
  const by = {
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    'year-desc': (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
    'mileage-asc': (a, b) => (a.mileage ?? Infinity) - (b.mileage ?? Infinity),
    title: compareTitle,
  }[sort] || ((a, b) => a.price - b.price);
  return filtered.sort((a, b) => by(a, b) || compareTitle(a, b));
}

function cleanFavoriteIds(ids) {
  if (!Array.isArray(ids) && !(ids instanceof Set)) return [];
  return [...new Set([...ids].filter(id => typeof id === 'string' && VEHICLE_ID.test(id)))].slice(0, MAX_VEHICLES);
}

export function readFavoriteIds(storage) {
  try {
    const value = (storage ?? globalThis.localStorage)?.getItem(FAVORITES_KEY);
    return cleanFavoriteIds(value ? JSON.parse(value) : []);
  } catch { return []; }
}

/** Returns false when storage is unavailable; the UI can keep in-memory state. */
export function saveFavoriteIds(storage, ids) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (typeof target?.setItem !== 'function') return false;
    target.setItem(FAVORITES_KEY, JSON.stringify(cleanFavoriteIds(ids)));
    return true;
  } catch { return false; }
}

export function formatPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? currency.format(value) : 'Preço sob consulta';
}

export function formatMileage(value) {
  return Number.isSafeInteger(value) && value >= 0
    ? `${integer.format(value)} km` : 'Quilómetros por confirmar';
}

function catalogueUrl(origin = PRODUCTION_ORIGIN) {
  let base;
  try { base = new URL(origin); } catch { throw new Error('Endereço do catálogo inválido.'); }
  const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && !localHttp || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) throw new Error('Endereço do catálogo inválido.');
  return new URL('/app/index.html', base.origin);
}

export function vehicleShareUrl(id, origin = PRODUCTION_ORIGIN) {
  if (typeof id !== 'string' || !VEHICLE_ID.test(id)) throw new Error('Viatura inválida.');
  const url = catalogueUrl(origin);
  url.searchParams.set('viatura', id);
  return url.href;
}

/** Prepare a click-to-chat link only; opening/sending remains a user action. */
export function whatsappUrl(item = null, origin = PRODUCTION_ORIGIN) {
  const message = item
    ? `Olá, tenho interesse nesta viatura: ${text(item.title, 500)} (${formatPrice(item.price)}). Pode dar-me mais informações?\n${vehicleShareUrl(item.id, origin)}`
    : `Olá, gostaria de saber mais sobre as viaturas da AutoValorPT.\n${catalogueUrl(origin).href}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
