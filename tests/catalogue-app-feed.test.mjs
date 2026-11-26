import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCatalogueAppFeed } from '../lib/catalogue-app-feed.js';
import { createStockSource, stockFeedCsv, stockFeedRow } from '../lib/stock-source.js';
import { META_CATALOG_SOURCE_URLS } from '../lib/meta-catalog-source.js';
import { memoryBlob } from './helpers/memory-blob.mjs';
import stockHandler from '../api/stock.js';

const checkedAt = '2026-11-26T08:12:03.000Z';
const fingerprint = csv => createHash('sha256').update(csv).digest('hex');
const car = (id = 'ID8Qapp01', fields = {}) => stockFeedRow({
  id, title: 'BMW X1 1.5 xDrive25e', brand: 'BMW', year: 2020, mileage: 68000,
  fuel: 'Híbrido Plug-In', price: '22990.00 EUR',
  link: `https://www.standvirtual.com/carros/anuncio/bmw-x1-${id}.html`,
  image: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image`, ...fields,
});
function snapshot(items = [car()], extra = {}) {
  const csv = stockFeedCsv(items);
  return { csv, fingerprint: fingerprint(csv), count: items.length, checkedAt, ...extra };
}
function response() {
  return {
    headers: {}, code: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}
async function call(handler, method = 'GET', query = {}) {
  const res = response();
  await handler({ method, query, headers: {} }, res);
  return res;
}

test('public catalogue projects the committed snapshot without scraping, writing or exposing private state', async () => {
  const blob = memoryBlob();
  const active = car(); const sold = { ...car('ID8Qsold1'), availability: 'out of stock' };
  const record = snapshot([active]);
  const state = {
    version: 1, inventoryUrl: META_CATALOG_SOURCE_URLS.inventory, seedUrl: META_CATALOG_SOURCE_URLS.stock,
    initializedAt: '2026-11-10T08:00:00.000Z', checkedAt, sourceCount: 1,
    feedHash: record.fingerprint, items: [active, sold], accessToken: 'PRIVATE_STATE_TOKEN',
  };
  const statePath = 'stock-source/v1/production/state.json';
  blob.records.set(statePath, { text: JSON.stringify(state), etag: 'state-1' });
  blob.records.set(`stock-source/v1/production/snapshots/${record.fingerprint}.csv`, { text: record.csv, etag: 'snapshot-1' });
  let networkCalls = 0;
  const source = createStockSource({ env: { VERCEL_ENV: 'production' }, storage: blob.storage,
    fetchImpl: async () => { networkCalls++; throw new Error('public_network_forbidden'); } });
  const handler = createCatalogueAppFeed({ source });
  const result = await call(handler);
  assert.equal(result.code, 200);
  assert.deepEqual(result.body, {
    ok: true, updatedAt: checkedAt, revision: record.fingerprint, total: 1,
    items: [{ id: 'ID8Qapp01', title: 'BMW X1 1.5 xDrive25e', brand: 'BMW', year: 2020,
      mileage: 68000, price: 22990, fuel: 'Híbrido Plug-In', image: active.image_link, url: active.link }],
    contact: { whatsapp: '351965637736' },
  });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['CDN-Cache-Control'], 'public, max-age=30, must-revalidate');
  assert.equal(result.headers['Set-Cookie'], undefined);
  assert.equal(networkCalls, 0);
  assert.equal(blob.calls.some(entry => entry.method !== 'get'), false);
  assert.equal(blob.records.get(statePath).text, JSON.stringify(state));
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_STATE_TOKEN|ID8Qsold1|seedUrl|itemSources/);
  assert.equal((await source.feed('latest')).checkedAt, checkedAt);
  assert.equal((await source.feed(record.fingerprint)).checkedAt, undefined);
});

test('explicit catalogue metadata preserves plug-in and conventional hybrids, decimals and original photos', async () => {
  const rows = [
    car('ID8Qplug1', { title: 'BMW X1 1.5 xDrive25e', fuel: 'Híbrido Plug-In', price: '22990.50 EUR' }),
    car('ID8Qhybr1', { title: 'Toyota Corolla 1.8', brand: 'Toyota', fuel: 'Híbrido (Gasolina)' }),
    car('ID8Qdies1', { title: 'Mercedes-Benz E 220 d | AMG', brand: 'Mercedes-Benz', fuel: 'Diesel', mileage: 0 }),
    car('ID8Qelec1', { title: 'Renault ZOE "Intens"', brand: 'Renault', fuel: 'Elétrico' }),
  ];
  const result = await call(createCatalogueAppFeed({ source: { feed: async () => snapshot(rows, { secret: 'PRIVATE_SNAPSHOT_TOKEN' }) } }));
  assert.equal(result.code, 200);
  assert.deepEqual(result.body.items.map(item => item.fuel), ['Híbrido Plug-In', 'Híbrido (Gasolina)', 'Diesel', 'Elétrico']);
  assert.equal(result.body.items[0].price, 22990.5);
  assert.equal(result.body.items[2].title, 'Mercedes-Benz E 220 d | AMG');
  assert.equal(result.body.items[2].mileage, 0);
  assert.equal(result.body.items[3].title, 'Renault ZOE "Intens"');
  assert.deepEqual(result.body.items.map(item => item.image), rows.map(item => item.image_link));
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_SNAPSHOT_TOKEN/);
});

test('legacy or conflicting text never becomes guessed year, mileage or fuel', async () => {
  const legacy = { ...car(), title: 'Peugeot 2008', description: 'Electric design. Contacte-nos.' };
  const conflicting = { ...car('ID8Qother'), description: 'BMW X1 1.5 xDrive25e. Gasolina. 2021. 68 000 km.' };
  const result = await call(createCatalogueAppFeed({ source: { feed: async () => snapshot([legacy, conflicting]) } }));
  assert.equal(result.code, 200);
  assert.deepEqual({ title: result.body.items[0].title, year: result.body.items[0].year,
    mileage: result.body.items[0].mileage, fuel: result.body.items[0].fuel },
  { title: 'Peugeot 2008', year: null, mileage: null, fuel: '' });
  assert.equal(result.body.items[1].year, 2020);
  assert.equal(result.body.items[1].fuel, '');
});

test('GET and HEAD read latest only; user parameters cannot synchronise, select snapshots or mutate stock', async () => {
  const calls = [];
  const source = {
    feed: async key => { calls.push(key); return snapshot(); },
    audit: () => assert.fail('public audit'), sync: () => assert.fail('public synchronization'),
  };
  const handler = createCatalogueAppFeed({ source });
  assert.equal((await call(handler, 'GET', { action: 'sync', snapshot: '../state.json', url: 'https://attacker.test' })).code, 200);
  const head = await call(handler, 'HEAD');
  assert.equal(head.code, 200); assert.equal(head.ended, true); assert.equal(head.body, undefined);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const result = await call(handler, method, { action: 'sync' });
    assert.equal(result.code, 405); assert.equal(result.headers.Allow, 'GET, HEAD');
  }
  assert.deepEqual(calls, ['latest', 'latest']);
  // Exercise the deployed multiplexer as well: the new integration must not
  // fall through to the legacy stock loader or another private integration.
  const routed = await call(stockHandler, 'POST', { integration: 'catalogue-app' });
  assert.equal(routed.code, 405); assert.equal(routed.headers.Allow, 'GET, HEAD');
});

test('missing, corrupt or unsafe snapshots fail closed with no empty catalogue or private diagnostic', async () => {
  const valid = snapshot();
  const mutations = [
    null,
    { ...valid, checkedAt: undefined },
    { ...valid, checkedAt: 'not-a-date' },
    { ...valid, fingerprint: 'f'.repeat(64) },
    { ...valid, count: 2 },
    snapshot([{ ...car(), availability: 'out of stock' }]),
    snapshot([{ ...car(), link: 'https://attacker.test/vehicle' }]),
    snapshot([{ ...car(), image_link: 'https://autovalorpt-assistente.vercel.app/api/stock?integration=catalog-image&secret=PRIVATE' }]),
    snapshot([car(), car()]),
  ];
  for (const value of mutations) {
    const result = await call(createCatalogueAppFeed({ source: { feed: async () => value } }));
    assert.equal(result.code, 503);
    assert.deepEqual(result.body, { ok: false, error: 'catalogue_unavailable' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(result.headers['CDN-Cache-Control'], undefined);
  }
  const unavailable = createCatalogueAppFeed({ source: { feed: async () => {
    throw Object.assign(new Error('PRIVATE_CREDENTIAL provider-details'), { token: 'PRIVATE_CREDENTIAL' });
  } } });
  assert.deepEqual((await call(unavailable)).body, { ok: false, error: 'catalogue_unavailable' });
  const head = await call(unavailable, 'HEAD');
  assert.equal(head.code, 503); assert.equal(head.body, undefined); assert.equal(head.ended, true);
});
