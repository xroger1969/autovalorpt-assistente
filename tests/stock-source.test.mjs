import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createStockSource, stockFeedCsv, stockSnapshotUrl } from '../lib/stock-source.js';
import { META_CATALOG_SOURCE_URLS as URLS } from '../lib/meta-catalog-source.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const STATE = 'stock-source/v1/production/state.json';
const env = { VERCEL_ENV: 'production' };
const now = () => Date.parse('2026-11-17T18:00:00Z');
const car = (id, fields = {}) => ({ id, title: 'Tesla Model 3 | 2022 | 138 000 km',
  description: 'Tesla Model 3. Elétrico. 2022. 138 000 km.', availability: 'in stock', condition: 'used',
  price: '31990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/tesla-model-3-${id}.html`,
  image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image`, brand: 'Tesla', ...fields });
const advert = item => ({ title: 'Tesla Model 3', url: item.link,
  price: { currencyCode: 'EUR', grossMinorAmount: Math.round(Number(item.price.split(' ')[0]) * 100) },
  photos: [item.image_link], attributes: [
    { key: 'make', value: 'tesla', valueLabel: 'Tesla' }, { key: 'new_used', value: 'used' },
    { key: 'first_registration_year', value: '2022' }, { key: 'mileage', value: '138000' },
    { key: 'fuel_type', value: 'electric', valueLabel: 'Elétrico' }
  ] });
const html = (items, count = items.length) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: {
  numberOfActiveAdverts: count, urqlState: { list: { data: JSON.stringify({ publishedAds: { total: count, ads: items.map(advert) } }) } }
} } })}</script>`;

function fixture(options = {}) {
  const blob = options.blob || memoryBlob(); const calls = [];
  const data = { items: options.items || [car('ID8stock1'), car('ID8stock2')], body: undefined,
    seed: options.seed || [car('ID8stock1'), car('ID8stock2'), car('ID8sold01', { availability: 'out of stock' })] };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.method, 'GET'); assert.ok(init.signal instanceof AbortSignal);
    const response = options.respond?.(url, init);
    if (response) return response;
    if (url === URLS.inventory) return new Response(data.body ?? html(data.items), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url === URLS.stock) return new Response(stockFeedCsv(data.seed), { headers: { 'content-type': 'text/csv' } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const source = createStockSource({ env: options.env || env, storage: options.storage || blob.storage, now, fetchImpl });
  return { source, blob, calls, data, fetchImpl };
}

test('seeds history once, appends new IDs and retains sold cars without reading Sheets again', async () => {
  const f = fixture(); const first = await f.source.sync();
  assert.equal(first.valid, true); assert.equal(first.status, 'source_synced');
  assert.deepEqual(first.outOfStockIds, ['ID8sold01']); assert.equal(first.expectedCount, 2);
  assert.equal(f.calls.filter(call => call.url === URLS.stock).length, 1);
  f.data.items = [car('ID8stock2', { price: '30990.00 EUR' }), car('ID8new003')];
  f.data.seed = []; // A stale/unavailable reporting sheet cannot replace server history.
  const second = await f.source.sync(); assert.equal(second.valid, true);
  assert.deepEqual(second.outOfStockIds, ['ID8sold01', 'ID8stock1']);
  const history = await f.source.loadFeed();
  assert.deepEqual(history.map(item => item.id), ['ID8stock1', 'ID8stock2', 'ID8sold01', 'ID8new003']);
  assert.equal(history[0].availability, 'out of stock'); assert.equal(history[1].price, '30990.00 EUR');
  assert.equal(history.at(-1).availability, 'in stock');
  assert.equal(f.calls.filter(call => call.url === URLS.stock).length, 1);
});

test('immutable CSV has exact hash and reads never fetch or write; older snapshots remain available', async () => {
  const f = fixture(); const first = await f.source.sync();
  const csv = stockFeedCsv(first.items);
  assert.equal(first.feedHash, createHash('sha256').update(csv).digest('hex'));
  assert.equal(first.feedUrl, stockSnapshotUrl(first.feedHash));
  assert.equal(first.snapshotUrl, first.feedUrl);
  const puts = f.blob.calls.filter(call => call.method === 'put').length; const requests = f.calls.length;
  assert.deepEqual(await f.source.feed(first.feedHash), { csv, fingerprint: first.feedHash, count: 2, contentType: 'text/csv; charset=utf-8' });
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, puts); assert.equal(f.calls.length, requests);
  f.data.items[0].price = '30000.00 EUR'; const second = await f.source.sync();
  assert.equal(second.valid, true); assert.notEqual(second.feedHash, first.feedHash);
  assert.equal((await f.source.feed(first.feedHash)).csv, csv);
  assert.equal(f.blob.records.get(`stock-source/v1/production/snapshots/${first.feedHash}.csv`).text, csv);
  await assert.rejects(() => f.source.feed('../state'), { code: 'stock_snapshot_invalid' });
  await assert.rejects(() => f.source.feed('0'.repeat(64)), { code: 'stock_snapshot_not_found' });
});

test('latest resolves only the committed immutable snapshot and never fetches inventory or writes', async () => {
  const f = fixture();
  await assert.rejects(() => f.source.feed('latest'), { code: 'stock_not_synchronized' });
  assert.equal(f.calls.length, 0); assert.equal(f.blob.records.size, 0);
  const first = await f.source.sync();
  const expected = await f.source.feed(first.feedHash);
  const writes = f.blob.calls.filter(call => call.method === 'put').length; const requests = f.calls.length;
  f.data.items[0].price = '30000.00 EUR'; // Public reads must not observe an uncommitted inventory change.
  assert.deepEqual(await f.source.feed('latest'), expected);
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes); assert.equal(f.calls.length, requests);
  const second = await f.source.sync();
  assert.notEqual(second.feedHash, first.feedHash);
  assert.equal((await f.source.feed('latest')).fingerprint, second.feedHash);
  assert.equal((await f.source.feed(first.feedHash)).fingerprint, first.feedHash);
});

test('invalid, partial and empty live inventories cannot write or overwrite state', async () => {
  for (const body of ['<html>Temporarily unavailable</html>', html([car('ID8stock1')], 2), html([])]) {
    const f = fixture(); f.data.body = body;
    assert.equal((await f.source.sync()).valid, false); assert.equal(f.blob.records.size, 0);
    f.data.body = undefined; assert.equal((await f.source.sync()).valid, true);
    const before = f.blob.records.get(STATE).text; const size = f.blob.records.size;
    f.data.body = body; assert.equal((await f.source.sync()).valid, false);
    assert.equal(f.blob.records.get(STATE).text, before); assert.equal(f.blob.records.size, size);
  }
});

test('suspicious drops use both seed active count and previous runtime count, never historical count', async () => {
  const seven = Array.from({ length: 7 }, (_, i) => car(`ID8stock${i}`));
  const seeded = fixture({ items: seven.slice(0, 3), seed: seven });
  assert.equal((await seeded.source.sync()).reason, 'source_suspicious_drop'); assert.equal(seeded.blob.records.size, 0);
  const f = fixture({ items: seven, seed: seven }); assert.equal((await f.source.sync()).valid, true);
  const before = f.blob.records.get(STATE).text;
  f.data.items = seven.slice(0, 3);
  assert.equal((await f.source.sync()).reason, 'source_suspicious_drop'); assert.equal(f.blob.records.get(STATE).text, before);
  const historical = fixture({ seed: [car('ID8stock1'), car('ID8stock2'), ...seven.map((item, i) => car(`ID8sold0${i}`, { availability: 'out of stock' }))] });
  assert.equal((await historical.source.sync()).valid, true);
  assert.equal((await historical.source.sync({ previousExpectedCount: 8 })).reason, 'source_suspicious_drop');
  assert.equal((await historical.source.audit({ previousExpectedCount: '8' })).reason, 'source_invalid_previous_count');
});

test('read-only audit and loadFeed block stale prices, IDs and images without modifying saved snapshot', async () => {
  const f = fixture(); assert.equal((await f.source.audit()).reason, 'stock_not_synchronized');
  assert.equal((await f.source.sync()).valid, true);
  const before = f.blob.records.get(STATE).text; const puts = f.blob.calls.filter(call => call.method === 'put').length;
  assert.equal((await f.source.audit()).valid, true);
  f.data.items[0].price = '29000.00 EUR';
  assert.equal((await f.source.audit()).reason, 'stock_source_changed');
  await assert.rejects(() => f.source.loadFeed(), { code: 'stock_source_changed' });
  assert.equal(f.blob.records.get(STATE).text, before);
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, puts);
});

test('CAS conflicts fail closed and never replace a newer state', async () => {
  const blob = memoryBlob(); const a = fixture({ blob }); const b = fixture({ blob });
  const results = await Promise.all([a.source.sync(), b.source.sync()]);
  assert.equal(results.filter(result => result.valid).length, 1);
  assert.equal(results.find(result => !result.valid).reason, 'source_sync_conflict');
  const before = blob.records.get(STATE).text;
  const rejectOverwrite = { ...blob.storage, async put(path, value, opts) {
    if (path === STATE && opts.ifMatch) throw Object.assign(new Error('conflict'), { status: 412 });
    return blob.storage.put(path, value, opts);
  } };
  const c = fixture({ blob, storage: rejectOverwrite, items: [car('ID8stock1'), car('ID8stock2'), car('ID8new003')] });
  assert.equal((await c.source.sync()).reason, 'source_sync_conflict');
  assert.equal(blob.records.get(STATE).text, before);
  const statePuts = blob.calls.filter(call => call.method === 'put' && call.path === STATE);
  assert.ok(statePuts.every(call => call.options.allowOverwrite === false || Boolean(call.options.ifMatch)));
});

test('production-only and malformed seeds do not initialize or publish a new baseline', async () => {
  const preview = fixture({ env: { VERCEL_ENV: 'preview' } });
  assert.equal((await preview.source.sync()).reason, 'stock_production_required'); assert.equal(preview.calls.length, 0);
  await assert.rejects(() => preview.source.feed('0'.repeat(64)), { code: 'stock_production_required' });
  for (const seed of [[], [car('ID8stock1', { description: '' })], [car('ID8stock1', { link: car('ID8other0').link })]]) {
    const f = fixture({ seed }); assert.equal((await f.source.sync()).valid, false); assert.equal(f.blob.records.size, 0);
  }
});

test('seed redirects are restricted to Google export and secrets never enter diagnostics', async () => {
  const f = fixture({ respond: url => url === URLS.stock ? new Response('', { status: 302, headers: { location: 'https://attacker.example/export' } }) : null });
  assert.equal((await f.source.sync()).reason, 'feed_redirect_not_allowed');
  assert.ok(f.calls.every(call => [URLS.stock, URLS.inventory].includes(call.url)));
  const broken = createStockSource({ env, storage: memoryBlob().storage, now,
    fetchImpl: async () => { throw new Error('bearer-secret-provider-detail'); } });
  const result = await broken.sync(); assert.equal(result.valid, false); assert.equal(JSON.stringify(result).includes('bearer'), false);
});

test('corrupt immutable snapshot and corrupt state fail closed', async () => {
  const f = fixture(); const result = await f.source.sync();
  const path = `stock-source/v1/production/snapshots/${result.feedHash}.csv`;
  const good = f.blob.records.get(path); f.blob.records.set(path, { ...good, text: good.text.replace('31990', '29990') });
  await assert.rejects(() => f.source.feed(result.feedHash), { code: 'stock_snapshot_invalid' });
  assert.equal((await f.source.audit()).reason, 'stock_snapshot_invalid');
  f.blob.records.set(path, good);
  const state = f.blob.records.get(STATE); const parsed = JSON.parse(state.text); parsed.feedHash = '0'.repeat(64);
  f.blob.records.set(STATE, { ...state, text: JSON.stringify(parsed) });
  assert.equal((await f.source.sync()).reason, 'stock_state_invalid');
  parsed.feedHash = result.feedHash; delete parsed.items[0].description;
  f.blob.records.set(STATE, { ...state, text: JSON.stringify(parsed) });
  assert.equal((await f.source.audit()).reason, 'stock_state_invalid');
});
