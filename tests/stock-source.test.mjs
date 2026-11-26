import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BlobAccessError, BlobError } from '@vercel/blob';
import { createStockSource, stockFeedCsv, stockSnapshotUrl } from '../lib/stock-source.js';
import { META_CATALOG_SOURCE_URLS as URLS } from '../lib/meta-catalog-source.js';
import { STOCK_INVENTORIES } from '../lib/stock-inventories.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const STATE = 'stock-source/v1/production/state.json';
const AUTOVALORPT = STOCK_INVENTORIES.find(source => source.id === 'autovalorpt').url;
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
    autovalorptItems: options.autovalorptItems, autovalorptBody: undefined,
    seed: options.seed || [car('ID8stock1'), car('ID8stock2'), car('ID8sold01', { availability: 'out of stock' })] };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.method, 'GET'); assert.ok(init.signal instanceof AbortSignal);
    const response = options.respond?.(url, init);
    if (response) return response;
    if (url === URLS.inventory) return new Response(data.body ?? html(data.items), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    // Existing single-set scenarios deliberately exercise an identical listing
    // in both origins. Multi-source scenarios provide distinct AutoValorPT rows.
    if (url === AUTOVALORPT) return new Response(data.autovalorptBody ?? html(data.autovalorptItems ?? data.items), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url === URLS.stock) return new Response(stockFeedCsv(data.seed), { headers: { 'content-type': 'text/csv' } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const source = createStockSource({ env: options.env || env, storage: options.storage || blob.storage, now, fetchImpl });
  return { source, blob, calls, data, fetchImpl };
}

function legacyState(blob, items) {
  const active = items.filter(item => item.availability === 'in stock').sort((a, b) => a.id.localeCompare(b.id));
  const csv = stockFeedCsv(active); const feedHash = createHash('sha256').update(csv).digest('hex');
  const state = { version: 1, inventoryUrl: URLS.inventory, seedUrl: URLS.stock,
    initializedAt: '2026-11-10T08:00:00.000Z', checkedAt: '2026-11-16T08:00:00.000Z',
    sourceCount: active.length, feedHash, items };
  blob.records.set(STATE, { text: JSON.stringify(state), etag: 'legacy-state' });
  blob.records.set(`stock-source/v1/production/snapshots/${feedHash}.csv`, { text: csv, etag: 'legacy-snapshot' });
  return state;
}

test('migrates Samucar v1 state to both inventories while retaining IDs, sold history and immutable snapshots', async () => {
  const auto = [car('ID8auto01'), car('ID8auto02')];
  const f = fixture({ autovalorptItems: auto });
  const legacy = legacyState(f.blob, f.data.seed);
  const before = f.blob.records.get(STATE).text;
  assert.equal((await f.source.feed('latest')).fingerprint, legacy.feedHash);
  assert.equal((await f.source.audit()).reason, 'stock_source_changed');
  assert.equal(f.blob.records.get(STATE).text, before);
  assert.equal(f.blob.calls.some(call => call.method === 'put'), false);
  const result = await f.source.sync();
  assert.equal(result.valid, true); assert.equal(result.sourceCount, 4);
  assert.deepEqual(result.sources.map(source => [source.id, source.count]), [['samucar', 2], ['autovalorpt', 2]]);
  assert.deepEqual(new Set(result.items.map(item => item.id)), new Set(['ID8stock1', 'ID8stock2', 'ID8auto01', 'ID8auto02']));
  assert.deepEqual(result.outOfStockIds, ['ID8sold01']);
  const saved = JSON.parse(f.blob.records.get(STATE).text);
  assert.equal(saved.version, 2); assert.equal(saved.initializedAt, legacy.initializedAt);
  assert.deepEqual(saved.itemSources.ID8sold01, ['samucar']);
  assert.deepEqual(saved.itemSources.ID8auto01, ['autovalorpt']);
  assert.equal(saved.items.find(item => item.id === 'ID8stock1').link, legacy.items[0].link);
  assert.equal(f.calls.some(call => call.url === URLS.stock), false);
  assert.equal((await f.source.feed(legacy.feedHash)).count, 2);
  assert.equal((await f.source.feed('latest')).fingerprint, result.feedHash);
  assert.equal((await f.source.audit()).valid, true);
});

test('new AutoValorPT listings cannot conceal a suspicious Samucar drop during v1 migration', async () => {
  const seven = Array.from({ length: 7 }, (_, i) => car(`ID8samuc${i}`));
  const auto = Array.from({ length: 5 }, (_, i) => car(`ID8auto0${i}`));
  const f = fixture({ items: seven.slice(0, 3), seed: seven, autovalorptItems: auto });
  legacyState(f.blob, seven);
  const before = f.blob.records.get(STATE).text;
  const result = await f.source.sync();
  assert.equal(result.reason, 'source_suspicious_drop'); assert.equal(result.sourceId, 'samucar');
  assert.equal(f.blob.records.get(STATE).text, before);
  assert.equal(f.blob.calls.some(call => call.method === 'put'), false);
  assert.equal((await f.source.audit()).reason, 'source_suspicious_drop');
});

test('per-source drop protection also catches a lost AutoValorPT majority despite healthy combined totals', async () => {
  const seven = Array.from({ length: 7 }, (_, i) => car(`ID8samuc${i}`));
  const auto = Array.from({ length: 5 }, (_, i) => car(`ID8auto0${i}`));
  const f = fixture({ items: seven, seed: seven, autovalorptItems: auto });
  assert.equal((await f.source.sync()).valid, true);
  const before = f.blob.records.get(STATE).text;
  const writes = f.blob.calls.filter(call => call.method === 'put').length;
  f.data.autovalorptItems = auto.slice(0, 1);
  const result = await f.source.sync();
  assert.equal(result.reason, 'source_suspicious_drop'); assert.equal(result.sourceId, 'autovalorpt');
  assert.equal(f.blob.records.get(STATE).text, before);
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes);
  assert.equal((await f.source.audit()).reason, 'source_suspicious_drop');
});

test('retiring a listing in either source preserves the other source and all historical rows', async () => {
  const auto = [car('ID8auto01'), car('ID8auto02')];
  const f = fixture({ autovalorptItems: auto });
  assert.equal((await f.source.sync()).valid, true);
  f.data.items = [car('ID8stock2')];
  const samucarSale = await f.source.sync();
  assert.equal(samucarSale.valid, true);
  assert.deepEqual(samucarSale.outOfStockIds, ['ID8sold01', 'ID8stock1']);
  assert.ok(auto.every(item => samucarSale.items.some(current => current.id === item.id)));
  f.data.autovalorptItems = [car('ID8auto02')];
  const autoSale = await f.source.sync();
  assert.equal(autoSale.valid, true);
  assert.deepEqual(autoSale.items.map(item => item.id), ['ID8auto02', 'ID8stock2']);
  assert.deepEqual(autoSale.outOfStockIds, ['ID8auto01', 'ID8sold01', 'ID8stock1']);
  const history = await f.source.loadFeed();
  assert.equal(history.length, 5);
  const saved = JSON.parse(f.blob.records.get(STATE).text);
  assert.deepEqual(saved.itemSources.ID8auto01, ['autovalorpt']);
  assert.deepEqual(saved.itemSources.ID8stock1, ['samucar']);
});

test('the same ID in both sources is one item and remains available until absent from both', async () => {
  const shared = car('ID8share1');
  const f = fixture({ items: [shared, car('ID8stock1')], seed: [shared, car('ID8stock1')],
    autovalorptItems: [shared, car('ID8auto01')] });
  const first = await f.source.sync();
  assert.equal(first.valid, true); assert.equal(first.sourceCount, 3);
  assert.deepEqual(first.sources.map(source => source.count), [2, 2]);
  const originalHash = first.feedHash;
  f.data.items = [car('ID8stock1')];
  assert.equal((await f.source.audit()).reason, 'stock_source_changed');
  const second = await f.source.sync();
  assert.equal(second.valid, true); assert.equal(second.feedHash, originalHash);
  assert.equal(second.outOfStockIds.includes(shared.id), false);
  const state = JSON.parse(f.blob.records.get(STATE).text);
  assert.deepEqual(state.itemSources[shared.id], ['samucar', 'autovalorpt']);
  assert.equal(state.sources[0].ids.includes(shared.id), false);
  assert.equal(state.sources[1].ids.includes(shared.id), true);
  assert.equal((await f.source.audit()).valid, true);
  f.data.autovalorptItems = [car('ID8auto01')];
  const third = await f.source.sync();
  assert.equal(third.valid, true); assert.deepEqual(third.outOfStockIds, [shared.id]);
});

test('the same ID with conflicting data cannot create or replace a snapshot', async () => {
  const f = fixture({ autovalorptItems: [car('ID8stock1', { price: '30000.00 EUR' })] });
  assert.equal((await f.source.sync()).reason, 'source_conflicting_vehicle');
  assert.equal(f.blob.records.size, 0);
  f.data.autovalorptItems = [car('ID8stock1')];
  assert.equal((await f.source.sync()).valid, true);
  const before = f.blob.records.get(STATE).text; const size = f.blob.records.size;
  f.data.autovalorptItems[0].price = '30000.00 EUR';
  assert.equal((await f.source.sync()).reason, 'source_conflicting_vehicle');
  assert.equal(f.blob.records.get(STATE).text, before); assert.equal(f.blob.records.size, size);
});

test('an empty, partial, malformed or timed-out AutoValorPT origin never removes its cars', async () => {
  let timeout = false;
  const f = fixture({ autovalorptItems: [car('ID8auto01'), car('ID8auto02')],
    respond: url => { if (timeout && url === AUTOVALORPT) throw new DOMException('private location', 'TimeoutError'); } });
  const first = await f.source.sync(); assert.equal(first.valid, true);
  const before = f.blob.records.get(STATE).text;
  const writes = f.blob.calls.filter(call => call.method === 'put').length;
  for (const body of [html([]), html([car('ID8auto01')], 2), '<html>Temporary error</html>']) {
    f.data.autovalorptBody = body;
    const result = await f.source.sync();
    assert.equal(result.valid, false); assert.equal(result.sourceId, 'autovalorpt');
    assert.equal(f.blob.records.get(STATE).text, before);
    assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes);
    assert.equal((await f.source.feed('latest')).fingerprint, first.feedHash);
  }
  f.data.autovalorptBody = undefined; timeout = true;
  const timedOut = await f.source.sync();
  assert.equal(timedOut.reason, 'source_timeout'); assert.equal(timedOut.sourceId, 'autovalorpt');
  assert.equal(JSON.stringify(timedOut).includes('private'), false);
  assert.equal(f.blob.records.get(STATE).text, before);
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes);
});

test('invalid provenance, source identities and source counts fail closed before any inventory request', async () => {
  const f = fixture({ autovalorptItems: [car('ID8auto01')] });
  assert.equal((await f.source.sync()).valid, true);
  const original = f.blob.records.get(STATE); const requests = f.calls.length;
  for (const mutate of [
    state => { state.sources[1].url = 'https://attacker.invalid/inventory'; },
    state => { state.sources[1].count = 2; },
    state => { delete state.itemSources.ID8auto01; },
    state => { state.itemSources.ID8auto01 = ['samucar']; },
    state => { state.sources[1].ids = ['ID8stock1']; },
  ]) {
    const state = JSON.parse(original.text); mutate(state);
    f.blob.records.set(STATE, { ...original, text: JSON.stringify(state) });
    assert.equal((await f.source.sync()).reason, 'stock_state_invalid');
    assert.equal(f.calls.length, requests);
  }
});

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

test('unchanged sync reuses the verified snapshot instead of issuing a duplicate SDK PUT', async () => {
  const blob = memoryBlob(); let snapshotPuts = 0;
  const storage = { ...blob.storage, async put(path, value, options) {
    if (path.includes('/snapshots/')) {
      snapshotPuts++;
      if (blob.records.has(path)) throw new BlobError('The blob already exists');
    }
    return blob.storage.put(path, value, options);
  } };
  const f = fixture({ blob, storage });
  const first = await f.source.sync(); assert.equal(first.valid, true);
  const path = `stock-source/v1/production/snapshots/${first.feedHash}.csv`;
  const original = blob.records.get(path);
  const second = await f.source.sync();
  assert.equal(second.valid, true); assert.equal(second.feedHash, first.feedHash);
  assert.equal(snapshotPuts, 1); assert.deepEqual(blob.records.get(path), original);
  const states = blob.calls.filter(call => call.method === 'put' && call.path === STATE);
  assert.equal(states.length, 2); assert.equal(states[0].options.allowOverwrite, false);
  assert.equal(states[1].options.allowOverwrite, true); assert.ok(states[1].options.ifMatch);
});

test('a plain SDK BlobError after a concurrent identical snapshot is accepted only after readback', async () => {
  const blob = memoryBlob(); let raced = false;
  const duplicate = new BlobError('The blob already exists');
  assert.equal(duplicate.name, 'Error'); assert.equal(duplicate.status, undefined); assert.equal(duplicate.code, undefined);
  const storage = { ...blob.storage, async put(path, value, options) {
    if (path.includes('/snapshots/')) {
      raced = true; assert.equal(options.allowOverwrite, false); assert.equal(options.ifMatch, undefined);
      // The pre-read saw no object; another writer committed these exact bytes.
      await blob.storage.put(path, value, options);
      throw duplicate;
    }
    return blob.storage.put(path, value, options);
  } };
  const f = fixture({ blob, storage }); const result = await f.source.sync();
  assert.equal(result.valid, true); assert.equal(raced, true);
  const path = `stock-source/v1/production/snapshots/${result.feedHash}.csv`;
  assert.equal(blob.calls.filter(call => call.method === 'get' && call.path === path).length, 2);
  assert.equal(blob.records.get(path).text, stockFeedCsv(result.items));
  assert.equal(JSON.parse(blob.records.get(STATE).text).feedHash, result.feedHash);
});

test('a failed snapshot PUT is never accepted without exact bytes or for unrelated storage errors', async () => {
  for (const mode of ['missing', 'corrupt', 'unrelated', 'forbidden']) {
    const blob = memoryBlob();
    const storage = { ...blob.storage, async put(path, value, options) {
      if (!path.includes('/snapshots/')) return blob.storage.put(path, value, options);
      if (mode !== 'missing') await blob.storage.put(path, mode === 'corrupt' ? value.replace('31990', '29990') : value, options);
      if (mode === 'unrelated') throw new Error('Unrelated storage fault');
      if (mode === 'forbidden') throw new BlobAccessError();
      throw new BlobError('The blob already exists');
    } };
    const f = fixture({ blob, storage }); const result = await f.source.sync();
    assert.equal(result.valid, false, mode);
    assert.equal(result.reason, mode === 'corrupt' ? 'stock_snapshot_invalid' : 'stock_source_unavailable', mode);
    assert.equal(blob.records.has(STATE), false, mode);
    assert.equal(blob.calls.some(call => call.method === 'put' && call.path === STATE), false, mode);
    assert.ok(blob.calls.filter(call => call.method === 'put').every(call => call.options.allowOverwrite === false));
  }
});

test('snapshot pre-read failures and hidden byte changes never become permission to create or overwrite', async () => {
  for (const mode of ['read-error', 'etag-mismatch', 'byte-order-mark']) {
    const f = fixture(); const first = await f.source.sync(); assert.equal(first.valid, true);
    const before = f.blob.records.get(STATE).text;
    const writes = f.blob.calls.filter(call => call.method === 'put').length;
    const path = `stock-source/v1/production/snapshots/${first.feedHash}.csv`;
    const storage = { ...f.blob.storage };
    if (mode === 'read-error') storage.get = async (requested, options) => {
      if (requested === path) throw new Error('Storage unavailable');
      return f.blob.storage.get(requested, options);
    };
    if (mode === 'etag-mismatch') storage.head = async requested => requested === path ? { etag: 'unexpected-version' } : f.blob.storage.head(requested);
    if (mode === 'byte-order-mark') {
      const record = f.blob.records.get(path);
      f.blob.records.set(path, { ...record, text: '\uFEFF' + record.text });
    }
    const retry = fixture({ blob: f.blob, storage });
    const result = await retry.source.sync();
    assert.equal(result.valid, false, mode);
    assert.equal(result.reason, mode === 'byte-order-mark' ? 'stock_snapshot_invalid' : 'stock_source_unavailable', mode);
    assert.equal(f.blob.records.get(STATE).text, before, mode);
    assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes, mode);
  }
});

test('latest resolves only the committed immutable snapshot and never fetches inventory or writes', async () => {
  const f = fixture();
  await assert.rejects(() => f.source.feed('latest'), { code: 'stock_not_synchronized' });
  assert.equal(f.calls.length, 0); assert.equal(f.blob.records.size, 0);
  const first = await f.source.sync();
  const expected = await f.source.feed(first.feedHash);
  const writes = f.blob.calls.filter(call => call.method === 'put').length; const requests = f.calls.length;
  f.data.items[0].price = '30000.00 EUR'; // Public reads must not observe an uncommitted inventory change.
  assert.deepEqual(await f.source.feed('latest'), { ...expected, checkedAt: first.checkedAt });
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
  assert.ok(f.calls.every(call => [URLS.stock, ...STOCK_INVENTORIES.map(source => source.url)].includes(call.url)));
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
