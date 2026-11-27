import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanVehicleIds, filterVehicles, formatMileage, formatPrice, fuelCategory,
  isSnapshotStale, MAX_COMPARISON_VEHICLES, MAX_VEHICLE_IMAGES, normalizeInventory, reconcileCatalogueSnapshot, STOCK_STALE_AFTER_MS,
  toggleComparisonIds, vehicleShareMessage, vehicleShareUrl, whatsappUrl,
  type Vehicle,
} from '../src/catalogue.ts';

const car = (id: string, changes: Partial<Vehicle> = {}): Vehicle => ({
  id, title: 'Renault Zoe Intens 50', brand: 'Renault', year: 2020, mileage: 150_870,
  price: 12990, fuel: 'Elétrico', image: 'https://ireland.apollo.olxcdn.com/v1/files/original/image',
  images: ['https://ireland.apollo.olxcdn.com/v1/files/original/image'],
  url: `https://www.standvirtual.com/carros/anuncio/renault-zoe-${id}.html`, ...changes,
});
const vehicle = car('ID8Q1pLS');
const payload = (items: Vehicle[] = [vehicle]) => ({
  ok: true, updatedAt: '2026-11-26T08:00:00.000Z', revision: 'a'.repeat(64), total: items.length, items,
});

test('validates and explicitly projects the complete public catalogue', () => {
  const input = payload([{ ...vehicle, privateNote: 'never persist', accessToken: 'secret' } as Vehicle]);
  const snapshot = normalizeInventory(input);
  assert.equal(snapshot.updatedAt, input.updatedAt);
  assert.deepEqual(snapshot.items, [vehicle]);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
  assert.notEqual(snapshot.items[0], input.items[0]);
});

test('a bad row, duplicate, count mismatch or invalid date rejects the whole response', () => {
  const base = payload();
  for (const invalid of [
    null, { ...base, ok: false }, { ...base, total: 2 }, { ...base, total: 0 },
    { ...base, revision: 'unverified' }, { ...base, updatedAt: '2026-02-30T08:00:00Z' },
    { ...base, updatedAt: '2026-11-26T24:00:00Z' }, payload([vehicle, vehicle]),
    payload([{ ...vehicle, price: NaN }]), payload([{ ...vehicle, price: -1 }]),
    payload([{ ...vehicle, year: 1800 }]), payload([{ ...vehicle, mileage: -1 }]),
    payload([{ ...vehicle, title: '<script>unsafe</script>' }]),
  ]) assert.throws(() => normalizeInventory(invalid));
  const nullable = normalizeInventory(payload([{ ...vehicle, year: null, mileage: null }]));
  assert.equal(nullable.items[0].mileage, null);
});

test('allows only original images and adverts belonging to the matching public vehicle ID', () => {
  for (const image of [
    'javascript:alert(1)', 'http://ireland.apollo.olxcdn.com/v1/files/original/image',
    'https://evil.example/image', 'https://ireland.apollo.olxcdn.com.evil.example/v1/files/x/image',
    'https://secret@ireland.apollo.olxcdn.com/v1/files/original/image',
    'https://ireland.apollo.olxcdn.com/v1/files/original/image?token=private',
  ]) assert.throws(() => normalizeInventory(payload([{ ...vehicle, image }])));
  for (const url of [
    'https://evil.example/carros/anuncio/renault-ID8Q1pLS.html',
    'https://www.standvirtual.com/carros/anuncio/renault-ID8Q1lYB.html',
    'https://www.standvirtual.com/carros/anuncio/renault-ID8Q1pLS.html?secret=x',
  ]) assert.throws(() => normalizeInventory(payload([{ ...vehicle, url }])));
});

test('preserves the full original gallery in order and makes an independent copy', () => {
  const side = 'https://ireland.apollo.olxcdn.com/v1/files/side/image';
  const interior = 'https://ireland.apollo.olxcdn.com/v1/files/interior/image';
  const images = [vehicle.image, side, interior, side];
  const snapshot = normalizeInventory(payload([{ ...vehicle, images }]));
  assert.deepEqual(snapshot.items[0].images, [vehicle.image, side, interior]);
  assert.equal(snapshot.items[0].image, vehicle.image);
  assert.notEqual(snapshot.items[0].images, images);
  assert.equal(images.length, 4);
});

test('legacy saved catalogues without a gallery remain usable with the original cover', () => {
  const { images: _gallery, ...legacy } = vehicle;
  const base = payload();
  const snapshot = normalizeInventory({ ...base, items: [legacy] });
  assert.deepEqual(snapshot.items[0].images, [vehicle.image]);
  assert.equal(snapshot.items[0].image, vehicle.image);
});

test('the first refresh restores a legacy cached gallery even when its server revision and date are current', () => {
  const { images: _gallery, ...legacy } = vehicle;
  const cached = normalizeInventory({ ...payload(), items: [legacy] });
  const images = [vehicle.image, 'https://ireland.apollo.olxcdn.com/v1/files/interior/image'];
  const received = normalizeInventory(payload([{ ...vehicle, images }]));
  assert.equal(cached.revision, received.revision);
  assert.equal(cached.updatedAt, received.updatedAt);
  const displayed = reconcileCatalogueSnapshot(cached, received);
  assert.equal(displayed, received);
  assert.deepEqual(displayed.items[0].images, images);
  assert.deepEqual(cached.items[0].images, [vehicle.image], 'refresh does not mutate the old cached copy');
});

test('an unchanged validated catalogue keeps its instance while new metadata is adopted', () => {
  const images = [vehicle.image, 'https://ireland.apollo.olxcdn.com/v1/files/interior/image'];
  const input = payload([{ ...vehicle, images }]);
  const previous = normalizeInventory(input);
  const received = normalizeInventory(input);
  assert.notEqual(previous.items[0].images, received.items[0].images);
  assert.equal(reconcileCatalogueSnapshot(previous, received), previous);
  assert.equal(reconcileCatalogueSnapshot(null, received), received);
  for (const next of [
    normalizeInventory({ ...input, revision: 'b'.repeat(64) }),
    normalizeInventory({ ...input, updatedAt: '2026-11-27T08:00:00.000Z' }),
  ]) assert.equal(reconcileCatalogueSnapshot(previous, next), next);
});

test('photo replacement, reordering and removal are reflected even with unchanged server metadata', () => {
  const side = 'https://ireland.apollo.olxcdn.com/v1/files/side/image';
  const interior = 'https://ireland.apollo.olxcdn.com/v1/files/interior/image';
  const replacement = 'https://ireland.apollo.olxcdn.com/v1/files/new-interior/image';
  const previous = normalizeInventory(payload([{ ...vehicle, images: [vehicle.image, side, interior] }]));
  for (const images of [
    [vehicle.image, side, replacement], [vehicle.image, interior, side], [vehicle.image, side],
  ]) {
    const received = normalizeInventory(payload([{ ...vehicle, images }]));
    const displayed = reconcileCatalogueSnapshot(previous, received);
    assert.equal(displayed, received);
    assert.deepEqual(displayed.items[0].images, images);
  }
});

test('rejects unsafe or inconsistent galleries without hiding invalid entries', () => {
  const other = 'https://ireland.apollo.olxcdn.com/v1/files/side/image';
  for (const images of [
    null, [], 'not-an-array', [vehicle.image, null], [vehicle.image, { url: other }],
    [other, vehicle.image],
    [vehicle.image, 'https://untrusted.example/image'],
    [vehicle.image, `${other}?token=private`],
    [vehicle.image, 'javascript:alert(1)'],
  ]) {
    assert.throws(() => normalizeInventory({ ...payload(), items: [{ ...vehicle, images }] }));
  }
});

test('retains a complete 100-photo gallery and rejects unbounded input', () => {
  const images = [vehicle.image, ...Array.from({ length: MAX_VEHICLE_IMAGES - 1 }, (_, index) =>
    `https://ireland.apollo.olxcdn.com/v1/files/photo-${index}/image`)];
  const snapshot = normalizeInventory(payload([{ ...vehicle, images }]));
  assert.deepEqual(snapshot.items[0].images, images);
  assert.equal(snapshot.items[0].images.length, 100);
  assert.throws(() => normalizeInventory(payload([{ ...vehicle, images: [...images, images[0]] }])));
});

test('hybrids remain separate even when fuel also mentions electricity or gasoline', () => {
  for (const value of ['Híbrido (Gasolina)', 'Gasóleo Híbrido', 'PHEV', 'Plug-in', 'Electric / Petrol']) {
    assert.equal(fuelCategory(value), 'hybrid', value);
  }
  assert.equal(fuelCategory('100% Elétrico'), 'electric');
  assert.equal(fuelCategory('Gasóleo'), 'diesel');
  assert.equal(fuelCategory('Gasolina'), 'petrol');
  assert.equal(fuelCategory('Não indicado'), 'other');
});

test('combines accent-insensitive search, brand, fuel, price and favourites without mutating stock', () => {
  const stock = [
    car('ID8Q1lYB', { title: 'BMW X1', brand: 'BMW', fuel: 'Híbrido (Gasolina)', price: 22990, mileage: 94512 }),
    vehicle,
    car('ID8Q1pSL', { title: 'Peugeot e-2008', brand: 'Peugeot', price: 24990, year: 2024, mileage: 24990 }),
  ];
  const original = [...stock];
  assert.deepEqual(filterVehicles(stock, { query: 'zoe eletrico', brand: 'renault', fuel: 'electric', maxPrice: '15000' }).map(v => v.id), [vehicle.id]);
  assert.deepEqual(filterVehicles(stock, { fuel: 'hybrid' }).map(v => v.id), ['ID8Q1lYB']);
  assert.deepEqual(filterVehicles(stock, { favoritesOnly: true, favoriteIds: [vehicle.id], maxPrice: 12000 }), []);
  assert.deepEqual(filterVehicles(stock, { sort: 'year-desc' }).map(v => v.id), ['ID8Q1pSL', 'ID8Q1lYB', vehicle.id]);
  assert.deepEqual(filterVehicles(stock, { sort: 'mileage-asc' }).map(v => v.id), ['ID8Q1pSL', 'ID8Q1lYB', vehicle.id]);
  assert.deepEqual(stock, original);
});

test('comparison accepts exactly three unique vehicles and lets a selected vehicle be removed at the limit', () => {
  assert.equal(MAX_COMPARISON_VEHICLES, 3);
  const ids = ['ID8Q1pLS', 'ID8Q1lYB', 'ID8Q1pSL', 'ID8Q19HN'];
  let selected: string[] = [];
  for (const id of ids.slice(0, 3)) selected = toggleComparisonIds(selected, id)!;
  assert.deepEqual(selected, ids.slice(0, 3));
  assert.equal(toggleComparisonIds(selected, ids[3]), null);
  assert.deepEqual(toggleComparisonIds(selected, ids[1]), [ids[0], ids[2]]);
  assert.equal(toggleComparisonIds(selected, 'invalid'), null);
  assert.deepEqual(cleanVehicleIds([ids[0], ids[0], 'invalid', null, ...ids], 3), ids.slice(0, 3));
  assert.deepEqual(selected, ids.slice(0, 3), 'a rejected toggle does not mutate existing preferences');
});

test('source age remains stale after 36 hours regardless of a fresh API read', () => {
  const updatedAt = '2026-11-26T08:00:00.000Z';
  const checked = Date.parse(updatedAt);
  assert.equal(isSnapshotStale({ updatedAt }, checked + STOCK_STALE_AFTER_MS), false);
  assert.equal(isSnapshotStale({ updatedAt }, checked + STOCK_STALE_AFTER_MS + 1), true);
  assert.equal(isSnapshotStale({ updatedAt: 'invalid' }, checked), true);
  assert.equal(isSnapshotStale(null, checked), true);
});

test('share and WhatsApp helpers prepare explicit public links without sending anything', () => {
  assert.equal(vehicleShareUrl(vehicle), vehicle.url);
  assert.match(vehicleShareMessage(vehicle), /Renault Zoe Intens 50/);
  const link = new URL(whatsappUrl(vehicle));
  assert.equal(link.origin + link.pathname, 'https://wa.me/351965637736');
  assert.match(link.searchParams.get('text') || '', /Renault Zoe Intens 50/);
  assert.ok(link.searchParams.get('text')?.includes(vehicle.url));
  assert.equal(new URL(whatsappUrl()).pathname, '/351965637736');
  assert.throws(() => vehicleShareUrl({ ...vehicle, url: 'javascript:alert(1)' }));
  assert.equal(formatPrice(12990).replace(/\s/g, ''), '12990€');
  assert.equal(formatMileage(150870).replace(/\s/g, ''), '150870km');
  assert.equal(formatMileage(null), 'Quilómetros por confirmar');
});
