/** Public catalogue data only. This module cannot update stock or publish messages. */
export const CATALOGUE_ENDPOINT = 'https://autovalorpt-assistente.vercel.app/api/stock?integration=catalogue-app';
export const WHATSAPP_NUMBER = '351965637736';
export const MAX_COMPARISON_VEHICLES = 3;
export const STOCK_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const MAX_VEHICLE_IMAGES = 100;
const VEHICLE_ID = /^ID[A-Za-z0-9]{5,30}$/;
const REVISION = /^[a-f0-9]{64}$/;
const MAX_VEHICLES = 2000;

export interface Vehicle {
  id: string;
  title: string;
  brand: string;
  year: number | null;
  mileage: number | null;
  price: number;
  fuel: string;
  image: string;
  images: string[];
  url: string;
}

export interface Snapshot {
  items: Vehicle[];
  updatedAt: string;
  revision: string;
}

export type FuelCategory = 'electric' | 'hybrid' | 'diesel' | 'petrol' | 'other';
export type SortOrder = 'price-asc' | 'price-desc' | 'year-desc' | 'mileage-asc' | 'title';
export interface VehicleFilters {
  query?: string;
  fuel?: FuelCategory | 'all';
  brand?: string;
  maxPrice?: number | string | null;
  sort?: SortOrder;
  favoritesOnly?: boolean;
  favoriteIds?: readonly string[];
}

export const FUEL_LABELS: Record<FuelCategory | 'all', string> = {
  all: 'Todos', electric: 'Elétricos', hybrid: 'Híbridos',
  diesel: 'Gasóleo', petrol: 'Gasolina', other: 'Outros',
};

const currency = new Intl.NumberFormat('pt-PT', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
const integer = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 0 });
const collator = new Intl.Collator('pt-PT', { sensitivity: 'base', numeric: true });
const fold = (value: unknown): string => typeof value === 'string'
  ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
  : '';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalidInventory = (): Error => new Error('Não foi possível confirmar o catálogo recebido.');

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f<>]/.test(value)) {
    throw invalidInventory();
  }
  const result = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!allowEmpty && !result) throw invalidInventory();
  return result;
}

export function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw invalidInventory();
  }
  const datePart = value.slice(0, 10);
  const calendarDate = new Date(`${datePart}T00:00:00Z`);
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== datePart) throw invalidInventory();
  return new Date(millis).toISOString();
}

function publicUrl(value: unknown, kind: 'advert' | 'image', id?: string): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\]/.test(value)) throw invalidInventory();
  let url: URL;
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

/** Older API responses and saved snapshots contain only the cover image. */
function normalizeImages(value: unknown, cover: string): string[] {
  if (value === undefined) return [cover];
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VEHICLE_IMAGES) throw invalidInventory();
  const images = [...new Set(value.map(image => publicUrl(image, 'image')))];
  // Keep the cover and gallery consistent; a malformed response must never
  // silently replace a known-good local catalogue.
  if (images[0] !== cover) throw invalidInventory();
  return images;
}

/** Reject the complete response if a row, count or identifier is invalid. */
export function normalizeInventory(payload: unknown): Snapshot {
  if (!isRecord(payload) || payload.ok !== true || typeof payload.revision !== 'string' ||
      !REVISION.test(payload.revision) || !Array.isArray(payload.items) ||
      typeof payload.total !== 'number' || !Number.isSafeInteger(payload.total) ||
      payload.total < 0 || payload.total > MAX_VEHICLES || payload.total !== payload.items.length) {
    throw invalidInventory();
  }
  const updatedAt = normalizeTimestamp(payload.updatedAt);
  const ids = new Set<string>();
  const maximumYear = new Date().getUTCFullYear() + 1;
  const items: Vehicle[] = payload.items.map((item: unknown) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !VEHICLE_ID.test(item.id) || ids.has(item.id) ||
        typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price <= 0 || item.price > 9_999_999.99 ||
        !(item.year === null || typeof item.year === 'number' && Number.isSafeInteger(item.year) && item.year >= 1900 && item.year <= maximumYear) ||
        !(item.mileage === null || typeof item.mileage === 'number' && Number.isSafeInteger(item.mileage) && item.mileage >= 0 && item.mileage <= 3_000_000)) {
      throw invalidInventory();
    }
    ids.add(item.id);
    const image = publicUrl(item.image, 'image');
    // Never spread the server object into local storage or components.
    return {
      id: item.id, title: text(item.title, 500), brand: text(item.brand, 100),
      year: item.year as number | null, mileage: item.mileage as number | null,
      price: item.price, fuel: text(item.fuel, 100, true),
      image, images: normalizeImages(item.images, image), url: publicUrl(item.url, 'advert', item.id),
    };
  });
  return { updatedAt, revision: payload.revision, items };
}

export function fuelCategory(fuel: unknown): FuelCategory {
  const label = fold(fuel);
  const hasElectric = /\b(?:eletric[oa]s?|electric(?:[oa]s?)?|bev)\b/.test(label);
  const hasPetrol = /\b(?:gasolina|gasoline|petrol|benzina)\b/.test(label);
  const hasDiesel = /\b(?:gasoleo|diesel)\b/.test(label);
  if (/\b(?:hibrid\w*|hybrid\w*|phev|mhev|hev)\b|\bplug[\s-]?in\b/.test(label) ||
      hasElectric && (hasPetrol || hasDiesel)) return 'hybrid';
  if (hasElectric) return 'electric';
  if (hasDiesel) return 'diesel';
  if (hasPetrol) return 'petrol';
  return 'other';
}

export function filterVehicles(items: readonly Vehicle[], {
  query = '', fuel = 'all', brand = 'all', maxPrice = null,
  sort = 'price-asc', favoritesOnly = false, favoriteIds = [],
}: VehicleFilters = {}): Vehicle[] {
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
  const title = (a: Vehicle, b: Vehicle): number => collator.compare(a.title, b.title) || collator.compare(a.id, b.id);
  const comparators: Record<SortOrder, (a: Vehicle, b: Vehicle) => number> = {
    'price-asc': (a, b) => a.price - b.price,
    'price-desc': (a, b) => b.price - a.price,
    'year-desc': (a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity),
    'mileage-asc': (a, b) => (a.mileage ?? Infinity) - (b.mileage ?? Infinity),
    title,
  };
  const compare = comparators[sort] || comparators['price-asc'];
  return filtered.sort((a, b) => compare(a, b) || title(a, b));
}

export function cleanVehicleIds(value: unknown, limit = MAX_VEHICLES): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && VEHICLE_ID.test(id)))].slice(0, limit);
}

/** null means that an invalid ID or the three-vehicle limit blocked the change. */
export function toggleComparisonIds(current: readonly string[], id: string): string[] | null {
  if (!cleanVehicleIds([id]).length) return null;
  const selected = cleanVehicleIds([...current], MAX_COMPARISON_VEHICLES);
  if (selected.includes(id)) return selected.filter(value => value !== id);
  if (selected.length >= MAX_COMPARISON_VEHICLES) return null;
  return [...selected, id];
}

/** A successful API read does not make an old source synchronisation current. */
export function isSnapshotStale(snapshot: Pick<Snapshot, 'updatedAt'> | null, now = Date.now()): boolean {
  if (!snapshot) return true;
  const updated = Date.parse(snapshot.updatedAt);
  return !Number.isFinite(updated) || now - updated > STOCK_STALE_AFTER_MS;
}

export function formatPrice(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? currency.format(value) : 'Preço sob consulta';
}

export function formatMileage(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? `${integer.format(value)} km` : 'Quilómetros por confirmar';
}

/** The original advert is already public and opens without the native app. */
export function vehicleShareUrl(item: Vehicle): string {
  return publicUrl(item.url, 'advert', item.id);
}

export function vehicleShareMessage(item: Vehicle): string {
  return `${text(item.title, 500)} · ${formatPrice(item.price)}\n${vehicleShareUrl(item)}`;
}

/** Only prepares a link. Linking.openURL and the final send remain user actions. */
export function whatsappUrl(item: Vehicle | null = null): string {
  const message = item
    ? `Olá, tenho interesse nesta viatura: ${text(item.title, 500)} (${formatPrice(item.price)}). Pode dar-me mais informações?\n${vehicleShareUrl(item)}`
    : 'Olá, gostaria de saber mais sobre as viaturas da AutoValorPT.';
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
