import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAVORITES_KEY, normalizeInventory, fuelCategory, filterVehicles,
  readFavoriteIds, saveFavoriteIds, formatPrice, formatMileage, vehicleShareUrl, whatsappUrl,
} from '../app/catalogue-core.js';

function vehicle(overrides = {}) {
  const id = overrides.id || 'ID8Qalpha';
  return {
    id, title: 'Tesla Model 3 Long Range Tração Integral', brand: 'Tesla', year: 2023,
    mileage: 99632, price: 31990, fuel: 'Elétrico',
    image: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image`,
    url: `https://www.standvirtual.com/carros/anuncio/modelo-${id}.html`,
    ...overrides,
  };
}

const inventory = (items = [vehicle()], overrides = {}) => ({
  ok: true, updatedAt: '2026-11-26T08:00:00.000Z', revision: 'a'.repeat(64), total: items.length, items, ...overrides,
});
const spaced = value => value.replace(/\s/g, ' ');

test('inventory validation projects only public fields and preserves original photography', () => {
  const item = vehicle({ secret: 'never retain', image: 'https://ireland.apollo.olxcdn.com/v1/files/original/image;s=960x0' });
  const result = normalizeInventory(inventory([item], { token: 'never retain' }));
  assert.equal(result.items[0].image, item.image);
  assert.equal(result.items[0].secret, undefined);
  assert.equal(result.token, undefined);
  assert.deepEqual(Object.keys(result), ['updatedAt', 'revision', 'items']);
  assert.notEqual(result.items[0], item);
  assert.equal(result.updatedAt, '2026-11-26T08:00:00.000Z');
  assert.deepEqual(normalizeInventory(inventory([])).items, []);
  const unknown = vehicle({ year: null, mileage: null, fuel: '', url: 'https://standvirtual.com/carros/anuncio/modelo-ID8Qalpha.html' });
  assert.deepEqual(normalizeInventory(inventory([unknown])).items, [unknown]);
});

test('corrupt or incomplete snapshots cannot silently replace the catalogue with partial results', () => {
  const good = vehicle();
  for (const payload of [
    null, [], { ...inventory(), ok: false }, inventory([good], { total: 0 }),
    inventory([good], { total: 2 }), inventory([good, good]),
    inventory([good], { revision: '../private' }), inventory([good], { updatedAt: 'today' }),
    inventory([good], { updatedAt: '2026-02-30T08:00:00.000Z' }),
    inventory([good, vehicle({ id: 'ID8Qbravo', price: NaN })]),
    inventory([vehicle({ price: -1 })]), inventory([vehicle({ price: '12 990 €' })]),
    inventory([vehicle({ year: undefined })]), inventory([vehicle({ year: 1880 })]),
    inventory([vehicle({ mileage: 3.5 })]), inventory([vehicle({ mileage: 3_000_001 })]),
    inventory([vehicle({ title: '<script>alert(1)</script>' })]),
  ]) assert.throws(() => normalizeInventory(payload));
});

test('inventory links permit only the correct public advert and original OLX image', () => {
  const attacks = [
    { url: 'javascript:alert(1)' },
    { url: 'https://www.standvirtual.com.evil.test/carros/anuncio/modelo-ID8Qalpha.html' },
    { url: 'https://user:password@www.standvirtual.com/carros/anuncio/modelo-ID8Qalpha.html' },
    { url: 'https://www.standvirtual.com/carros/anuncio/modelo-ID8Qbravo.html' },
    { url: 'https://www.standvirtual.com/carros/anuncio/modelo-ID8Qalpha.html?next=https://evil.test' },
    { url: 'https://www.standvirtual.com:8080/carros/anuncio/modelo-ID8Qalpha.html' },
    { image: 'https://private.blob.vercel-storage.com/customer-document' },
    { image: 'https://ireland.apollo.olxcdn.com.evil.test/v1/files/stock/image' },
    { image: 'https://ireland.apollo.olxcdn.com/v1/files/stock/image?token=secret' },
    { image: 'data:image/svg+xml,<svg></svg>' },
    { image: 'https://ireland.apollo.olxcdn.com/v1/files/stock/other-file' },
  ];
  for (const change of attacks) assert.throws(() => normalizeInventory(inventory([vehicle(change)])));
});

test('hybrids remain distinct from electric, petrol and diesel despite combined fuel labels', () => {
  for (const label of ['Híbrido (Gasolina)', 'Híbrido Plug-In', 'PHEV', 'MHEV', 'Hybrid Diesel',
    'Gasolina / Elétrico', 'Electric / Diesel', 'plug-in']) assert.equal(fuelCategory(label), 'hybrid', label);
  for (const label of ['Elétrico', ' ELÉCTRICO ', '100% elétrico', 'Electric', 'BEV']) {
    assert.equal(fuelCategory(label), 'electric', label);
  }
  assert.equal(fuelCategory('Gasóleo'), 'diesel');
  assert.equal(fuelCategory('DIESEL'), 'diesel');
  assert.equal(fuelCategory('Gasolina'), 'petrol');
  assert.equal(fuelCategory('GPL'), 'other');
  assert.equal(fuelCategory(''), 'other');
  assert.equal(fuelCategory(null), 'other');
});

test('search, price, brand, fuel and favourites combine without modifying the source order', () => {
  const rows = [
    vehicle(),
    vehicle({ id: 'ID8Qbravo', title: 'BMW X1', brand: 'BMW', fuel: 'Híbrido (Gasolina)', price: 22990, year: 2020, mileage: 94512 }),
    vehicle({ id: 'ID8Qzoe12', title: 'Renault Zoe Intens 50', brand: 'Renault', price: 12990, year: 2020, mileage: 150870 }),
    vehicle({ id: 'ID8Qdiesel', title: 'BMW 320d', brand: 'BMW', fuel: 'Gasóleo', price: 25990, year: 2022, mileage: 85000 }),
  ];
  const order = rows.map(row => row.id);
  assert.deepEqual(filterVehicles(rows, { query: 'tracao TESLA' }).map(row => row.id), ['ID8Qalpha']);
  assert.deepEqual(filterVehicles(rows, { fuel: 'hybrid' }).map(row => row.id), ['ID8Qbravo']);
  assert.deepEqual(filterVehicles(rows, { fuel: 'electric', maxPrice: 20000 }).map(row => row.id), ['ID8Qzoe12']);
  assert.deepEqual(filterVehicles(rows, {
    query: 'x1', brand: 'bmw', fuel: 'hybrid', maxPrice: 22990, favoritesOnly: true, favoriteIds: ['ID8Qbravo'],
  }).map(row => row.id), ['ID8Qbravo']);
  assert.deepEqual(filterVehicles(rows, { favoritesOnly: true, favoriteIds: [] }), []);
  assert.deepEqual(filterVehicles(rows, { query: 'viatura inexistente' }), []);
  assert.deepEqual(filterVehicles(rows, { sort: 'price-desc' }).map(row => row.price), [31990, 25990, 22990, 12990]);
  assert.deepEqual(rows.map(row => row.id), order);
});

test('sorting places missing years and mileage after known values', () => {
  const rows = [
    vehicle({ id: 'ID8Qempty', year: null, mileage: null }),
    vehicle({ id: 'ID8Qbravo', year: 2020, mileage: 90000 }),
    vehicle({ id: 'ID8Qalpha', year: 2023, mileage: 40000 }),
  ];
  for (const sort of ['year-desc', 'mileage-asc']) {
    assert.deepEqual(filterVehicles(rows, { sort }).map(row => row.id), ['ID8Qalpha', 'ID8Qbravo', 'ID8Qempty']);
  }
});

test('favourites survive reloads and handle blocked, corrupt or full storage', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  assert.equal(saveFavoriteIds(storage, ['ID8Qalpha', 'invalid', 'ID8Qalpha', 'ID8Qbravo']), true);
  assert.deepEqual(readFavoriteIds(storage), ['ID8Qalpha', 'ID8Qbravo']);
  assert.equal(data.has(FAVORITES_KEY), true);
  data.set(FAVORITES_KEY, '{broken'); assert.deepEqual(readFavoriteIds(storage), []);
  data.set(FAVORITES_KEY, '{"id":"ID8Qalpha"}'); assert.deepEqual(readFavoriteIds(storage), []);
  const unavailable = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(readFavoriteIds(unavailable), []);
  assert.equal(saveFavoriteIds(unavailable, ['ID8Qalpha']), false);
  assert.equal(saveFavoriteIds({}, ['ID8Qalpha']), false);
});

test('prices preserve cents and unknown mileage is not represented as zero', () => {
  assert.equal(spaced(formatPrice(12990)), '12 990 €');
  assert.equal(spaced(formatPrice(12990.5)), '12 990,5 €');
  assert.equal(formatPrice(NaN), 'Preço sob consulta');
  assert.equal(spaced(formatMileage(150870)), '150 870 km');
  assert.equal(formatMileage(0), '0 km');
  assert.equal(formatMileage(null), 'Quilómetros por confirmar');
});

test('sharing and WhatsApp prepare exact vehicle links and never execute a side effect', () => {
  const origin = 'https://autovalorpt-assistente.vercel.app';
  const share = vehicleShareUrl('ID8Qalpha', origin);
  assert.equal(share, `${origin}/app/index.html?viatura=ID8Qalpha`);
  assert.equal(vehicleShareUrl('ID8Qalpha', 'http://localhost:8000'), 'http://localhost:8000/app/index.html?viatura=ID8Qalpha');
  assert.throws(() => vehicleShareUrl('../private', origin));
  assert.throws(() => vehicleShareUrl('ID8Qalpha', 'javascript:alert(1)'));
  assert.throws(() => vehicleShareUrl('ID8Qalpha', 'https://user:password@evil.test'));
  assert.throws(() => vehicleShareUrl('ID8Qalpha', 'http://remote.test'));
  const link = new URL(whatsappUrl(vehicle(), origin));
  assert.equal(link.origin, 'https://wa.me');
  assert.equal(link.pathname, '/351965637736');
  assert.match(link.searchParams.get('text'), /Tesla Model 3/);
  assert.match(link.searchParams.get('text'), /31\s990\s€/);
  assert.ok(link.searchParams.get('text').endsWith(share));
  assert.match(new URL(whatsappUrl(null, origin)).searchParams.get('text'), /viaturas da AutoValorPT/);
});
