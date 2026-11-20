import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createCatalogSource } from '../lib/catalog-feed.js';
import { catalogHash, catalogImageUrl } from '../lib/catalog-images.js';
import { stockFeedCsv, stockSnapshotUrl } from '../lib/stock-source.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const red = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#aa1122' } }).png().toBuffer();
const blue = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#1122aa' } }).png().toBuffer();
const STATE = 'catalog-feed/v1/production/state.json';
const car = (id, extra = {}) => ({ id, title: 'BMW X1 | 2020 | 94 512 km', description: 'BMW X1. Híbrido. 2020. 94 512 km.',
  availability: 'in stock', condition: 'used', price: '22990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/bmw-x1-${id}.html`,
  image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image`, brand: 'BMW', ...extra });

function fixture(options = {}) {
  const blob = options.blob || memoryBlob(); const snapshots = new Map(); const requests = []; const preparations = [];
  const data = { items: [car('ID8samuc1'), ...Array.from({ length: options.autoCount ?? 2 }, (_, index) => car(`ID8auto0${index}`))],
    photos: new Map(), failSource: false };
  const raw = () => {
    const items = data.items.map(item => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id));
    const csv = stockFeedCsv(items); const feedHash = catalogHash(csv); snapshots.set(feedHash, csv);
    return { valid: true, status: 'source_matches', feedHash, feedUrl: stockSnapshotUrl(feedHash), snapshotUrl: stockSnapshotUrl(feedHash),
      checkedAt: '2026-11-21T08:00:00.000Z', sourceCount: items.length, expectedCount: items.length, items,
      sources: [{ id: 'samucar', count: 1, ids: ['ID8samuc1'] }, { id: 'autovalorpt', count: items.length - 1, ids: items.filter(item => item.id !== 'ID8samuc1').map(item => item.id) }],
      outOfStockIds: ['ID8sold01'] };
  };
  const stockSource = { async audit() { return data.failSource ? { valid: false, reason: 'source_unavailable' } : raw(); },
    async feed(fingerprint) {
      const csv = snapshots.get(fingerprint);
      if (!csv) throw Object.assign(new Error('missing raw snapshot'), { code: 'stock_snapshot_not_found' });
      return { csv, fingerprint, count: csv.trim().split('\r\n').length - 1, contentType: 'text/csv; charset=utf-8' };
    } };
  const fetchImpl = async (url, init) => {
    requests.push({ url, init }); assert.equal(init.redirect, 'error'); assert.equal(init.method, 'GET');
    assert.match(url, /^https:\/\/ireland\.apollo\.olxcdn\.com\/v1\/files\//);
    if (options.fetchImpl) return options.fetchImpl(url, init);
    return new Response(data.photos.get(url) || red, { headers: { 'content-type': 'image/png' } });
  };
  const preparePhoto = async input => {
    preparations.push(input);
    return options.preparePhoto ? options.preparePhoto(input) : { status: 'prepared', buffer: input.originalBuffer, mimeType: 'image/png', width: 8, height: 6 };
  };
  const settings = { stockSource, storage: options.storage || blob.storage, fetchImpl,
    now: () => Date.parse('2026-11-21T08:00:00.000Z'), ...options.settings,
    ...(options.noProcessor ? {} : { preparePhoto }) };
  return { blob, data, raw, stockSource, requests, preparations, settings, service: createCatalogSource(settings) };
}

test('prepares only AutoValorPT covers and preserves every factual field, original stock and source counts', async () => {
  const f = fixture(); const before = f.raw(); const result = await f.service.prepare();
  assert.equal(result.valid, true); assert.equal(result.expectedCount, 3); assert.equal(result.sourceCount, 3);
  assert.equal(f.preparations.length, 2); assert.deepEqual(result.preparedIds, ['ID8auto00', 'ID8auto01']);
  assert.deepEqual(result.imageSummary, { prepared: 2, unchanged: 0, pending: 0, review_required: 0, failed: 0 });
  assert.deepEqual(result.outOfStockIds, before.outOfStockIds);
  for (const item of result.items) {
    const original = before.items.find(row => row.id === item.id);
    assert.deepEqual({ ...item, image_link: original.image_link }, original);
    assert.equal(result.sourceOriginals[item.id], original.image_link);
    assert.equal(result.expectedImages[item.id], item.image_link);
    if (item.id === 'ID8samuc1') assert.equal(item.image_link, original.image_link);
    else assert.equal(item.image_link, catalogImageUrl(item.id, catalogHash(red)));
  }
  assert.deepEqual(f.raw(), before);
  assert.notEqual(result.feedHash, before.feedHash);
  assert.equal(result.imageRevision, catalogHash(JSON.stringify(Object.entries(result.expectedImages).sort(([a], [b]) => a.localeCompare(b)))));
  assert.equal((await f.service.feed('latest')).csv, stockFeedCsv(result.items));
  assert.equal((await f.service.audit()).feedHash, result.feedHash);
});

test('cache excludes price and mileage: unchanged sync and commercial edits never repeat preparation', async () => {
  const f = fixture(); const first = await f.service.prepare();
  assert.equal((await f.service.prepare()).valid, true); assert.equal(f.preparations.length, 2);
  f.data.items.find(item => item.id === 'ID8auto00').price = '21990.00 EUR';
  const changed = await f.service.prepare();
  assert.equal(changed.valid, true); assert.equal(f.preparations.length, 2);
  assert.notEqual(changed.feedHash, first.feedHash); assert.equal(changed.imageRevision, first.imageRevision);
  assert.equal(changed.items.find(item => item.id === 'ID8auto00').price, '21990.00 EUR');
  assert.equal((await f.service.feed(first.feedHash)).csv, stockFeedCsv(first.items));
});

test('audit, immutable feed and permanent image GETs never process, fetch originals or write', async () => {
  const f = fixture(); const result = await f.service.prepare();
  const writes = f.blob.calls.filter(call => call.method === 'put').length;
  const requests = f.requests.length; const calls = f.preparations.length;
  assert.equal((await f.service.audit()).valid, true);
  await f.service.feed(result.feedHash); await f.service.feed('latest');
  const asset = await f.service.image('ID8auto00', result.imageBindings.ID8auto00.outputHash);
  assert.ok(asset.buffer.equals(red)); assert.equal(asset.mimeType, 'image/png'); assert.equal(asset.width, 8);
  assert.equal(f.preparations.length, calls); assert.equal(f.requests.length, requests);
  assert.equal(f.blob.calls.filter(call => call.method === 'put').length, writes);
});

test('unchanged and review-required decisions preserve originals and are cached without automatic retry', async () => {
  const f = fixture({ preparePhoto: async ({ item }) => item.id === 'ID8auto00'
    ? { status: 'unchanged', reason: 'interior_original' } : { status: 'review_required', reason: 'outline_uncertain' } });
  const first = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(first.feedHash, f.raw().feedHash);
  assert.deepEqual(first.imageSummary, { prepared: 0, unchanged: 1, pending: 0, review_required: 1, failed: 0 });
  assert.equal((await f.service.feed('latest')).csv, stockFeedCsv(f.raw().items));
  assert.equal((await f.service.prepare()).valid, true); assert.equal(f.preparations.length, 2);
  assert.equal((await f.service.audit()).imageSummary.review_required, 1);
});

test('failed processors preserve all vehicles and cache failure without retrying every synchronization', async () => {
  const f = fixture({ preparePhoto: async () => { throw new Error('Private provider details'); } });
  const first = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(first.items.length, 3); assert.equal(first.imageSummary.failed, 2);
  assert.equal(JSON.stringify(first).includes('Private'), false);
  const second = await f.service.prepare(); assert.equal(second.valid, true); assert.equal(f.preparations.length, 2);
});

test('two-new-image limit leaves unclaimed work pending and the next synchronization processes it', async () => {
  const f = fixture({ autoCount: 3 }); const first = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(first.items.length, 4); assert.equal(f.preparations.length, 2);
  assert.deepEqual(first.imageSummary, { prepared: 2, unchanged: 0, pending: 1, review_required: 0, failed: 0 });
  assert.equal(first.imageDiagnostics.find(item => item.id === 'ID8auto02').reason, 'catalogue_image_budget');
  assert.equal([...f.blob.records.keys()].filter(path => path.includes('/jobs/')).length, 2);
  const second = await f.service.prepare();
  assert.equal(second.valid, true); assert.equal(second.imageSummary.prepared, 3); assert.equal(f.preparations.length, 3);
});

test('exhausted time budget and absent processor do not claim or permanently reject a photo', async () => {
  for (const options of [{ settings: { prepareBudgetMs: 0 } }, { settings: { prepareBudgetMs: 2000 } }, { noProcessor: true }]) {
    const f = fixture(options); const result = await f.service.prepare();
    assert.equal(result.valid, true); assert.equal(result.imageSummary.pending, 2); assert.equal(result.items.length, 3);
    assert.equal(f.preparations.length, 0); assert.equal([...f.blob.records.keys()].some(path => path.includes('/jobs/')), false);
    const ready = createCatalogSource({ ...f.settings, prepareBudgetMs: 85000,
      preparePhoto: async () => ({ status: 'prepared', buffer: red }) });
    assert.equal((await ready.prepare()).imageSummary.prepared, 2);
  }
});

test('concurrent claims never duplicate processing and an interrupted publication can reuse the ready result', async () => {
  let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ autoCount: 1, preparePhoto: async () => { entered(); await waiting; return { status: 'prepared', buffer: red }; } });
  const first = f.service.prepare(); await started;
  const other = createCatalogSource(f.settings);
  const concurrent = await other.prepare();
  assert.equal(concurrent.valid, true); assert.equal(concurrent.imageSummary.pending, 1); assert.equal(f.preparations.length, 1);
  release(); await first;
  const recovered = await f.service.prepare();
  assert.equal(recovered.valid, true); assert.equal(recovered.imageSummary.prepared, 1); assert.equal(f.preparations.length, 1);
});

test('an unacknowledged claim never starts processing or retries an uncertain stored job', async () => {
  const blob = memoryBlob();
  const storage = { ...blob.storage, async put(path, value, settings) {
    const saved = await blob.storage.put(path, value, settings);
    return path.includes('/jobs/') && settings.allowOverwrite === false ? { pathname: path } : saved;
  } };
  const f = fixture({ blob, storage, autoCount: 1 });
  const first = await f.service.prepare(); const second = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(second.valid, true);
  assert.equal(first.imageSummary.pending, 1); assert.equal(second.imageSummary.pending, 1);
  assert.equal(f.preparations.length, 0);
  const jobs = [...blob.records].filter(([path]) => path.includes('/jobs/'));
  assert.equal(jobs.length, 1); assert.equal(JSON.parse(jobs[0][1].text).status, 'processing');
});

test('processor timeout is recorded as unknown and never automatically repeated', { timeout: 5000 }, async () => {
  const f = fixture({ autoCount: 1, settings: { prepareBudgetMs: 1100, minNewPreparationMs: 1 },
    preparePhoto: async () => new Promise(() => {}) });
  const first = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(first.imageSummary.pending, 1); assert.equal(f.preparations.length, 1);
  const job = [...f.blob.records].find(([path]) => path.includes('/jobs/'));
  assert.equal(JSON.parse(job[1].text).status, 'unknown');
  const second = await f.service.prepare();
  assert.equal(second.valid, true); assert.equal(second.imageSummary.pending, 1); assert.equal(f.preparations.length, 1);
});

test('a lost finalization CAS preserves the processing claim and never exposes or regenerates its orphan output', async () => {
  const blob = memoryBlob();
  const storage = { ...blob.storage, async put(path, value, settings) {
    if (path.includes('/jobs/') && settings.ifMatch) throw Object.assign(new Error('CAS lost'), { status: 412 });
    return blob.storage.put(path, value, settings);
  } };
  const f = fixture({ blob, storage, autoCount: 1 });
  const first = await f.service.prepare(); const second = await f.service.prepare();
  assert.equal(first.valid, true); assert.equal(second.valid, true);
  assert.equal(first.imageSummary.pending, 1); assert.equal(second.imageSummary.pending, 1);
  assert.equal(f.preparations.length, 1);
  await assert.rejects(() => f.service.image('ID8auto00', catalogHash(red)), { code: 'catalog_image_not_found' });
});

test('a new original and a new recipe create new cache keys while old image and feed URLs remain valid', async () => {
  const f = fixture({ autoCount: 1 }); const first = await f.service.prepare();
  const changedUrl = 'https://ireland.apollo.olxcdn.com/v1/files/ID8changed/image';
  f.data.items.find(item => item.id === 'ID8auto00').image_link = changedUrl; f.data.photos.set(changedUrl, blue);
  const changed = await f.service.prepare();
  assert.equal(changed.valid, true); assert.equal(f.preparations.length, 2);
  assert.notEqual(changed.imageBindings.ID8auto00.jobKey, first.imageBindings.ID8auto00.jobKey);
  assert.ok((await f.service.image('ID8auto00', first.imageBindings.ID8auto00.outputHash)).buffer.equals(red));
  assert.ok((await f.service.image('ID8auto00', changed.imageBindings.ID8auto00.outputHash)).buffer.equals(blue));
  assert.equal((await f.service.feed(first.feedHash)).csv, stockFeedCsv(first.items));
  const nextRecipe = createCatalogSource({ ...f.settings, backgroundVersion: 'samucar-next' });
  assert.equal((await nextRecipe.prepare()).valid, true); assert.equal(f.preparations.length, 3);
  assert.equal((await nextRecipe.prepare()).valid, true); assert.equal(f.preparations.length, 3);
});

test('identical rendered pixels retain fresh provenance after URL, resize, original-byte or recipe changes', async () => {
  for (const change of ['url', 'resize', 'bytes', 'recipe']) {
    const f = fixture({ autoCount: 1, preparePhoto: async () => ({ status: 'prepared', buffer: red }) });
    const item = f.data.items.find(value => value.id === 'ID8auto00');
    if (change === 'resize') item.image_link += ';q=100;s=1000x0';
    const first = await f.service.prepare(); assert.equal(first.valid, true, change);
    const csvPath = `catalog-feed/v1/production/snapshots/${first.feedHash}.csv`;
    const proofPath = csvPath.replace(/\.csv$/, '.json');
    const originalCsv = f.blob.records.get(csvPath); const originalProof = f.blob.records.get(proofPath);
    const initialState = JSON.parse(f.blob.records.get(STATE).text);
    let service = f.service;
    if (change === 'url') item.image_link = 'https://ireland.apollo.olxcdn.com/v1/files/reuploaded/image';
    if (change === 'resize') item.image_link = item.image_link.replace(';q=100;', ';q=90;');
    if (change === 'bytes') f.data.photos.set(item.image_link, blue);
    if (change === 'recipe') service = createCatalogSource({ ...f.settings, backgroundVersion: 'samucar-next' });
    const second = await service.prepare();
    assert.equal(second.valid, true, change); assert.equal(second.feedHash, first.feedHash, change);
    assert.equal(second.imageRevision, first.imageRevision, change);
    assert.equal(f.preparations.length, change === 'resize' ? 1 : 2, change);
    assert.equal(second.sourceOriginals[item.id], item.image_link, change);
    const currentState = JSON.parse(f.blob.records.get(STATE).text);
    assert.notEqual(currentState.lineageHash, initialState.lineageHash, change);
    assert.equal(currentState.sourceFeedHash, f.raw().feedHash, change);
    assert.deepEqual(f.blob.records.get(csvPath), originalCsv, 'the content-addressed CSV is never overwritten');
    assert.deepEqual(f.blob.records.get(proofPath), originalProof, 'the first public proof is never overwritten');
    const audited = await service.audit();
    assert.equal(audited.valid, true, change);
    assert.deepEqual(audited.imageBindings, second.imageBindings, change);
    assert.equal(audited.sourceOriginals[item.id], item.image_link, change);
    assert.equal((await service.feed('latest')).csv, stockFeedCsv(second.items));
    assert.equal((await service.feed(first.feedHash)).csv, stockFeedCsv(first.items));
    const repeated = await service.prepare();
    assert.equal(repeated.valid, true, change);
    assert.equal(f.preparations.length, change === 'resize' ? 1 : 2, change);
    if (change === 'bytes') assert.notEqual(second.imageBindings[item.id].sourceHash, first.imageBindings[item.id].sourceHash);
    if (change === 'recipe') assert.equal(second.imageBindings[item.id].backgroundVersion, 'samucar-next');
    const lineagePath = `catalog-feed/v1/production/lineages/${second.feedHash}/${currentState.sourceFeedHash}/${currentState.lineageHash}.json`;
    f.blob.records.delete(lineagePath);
    assert.equal((await service.audit()).valid, false, 'missing current proof cannot fall back to older provenance');
    await assert.rejects(() => service.feed('latest'), { code: 'catalog_snapshot_invalid' });
    assert.equal((await service.feed(first.feedHash)).csv, stockFeedCsv(first.items));
  }
});

test('changed bytes under the same original URL invalidate the preparation cache', async () => {
  const f = fixture({ autoCount: 1 }); const first = await f.service.prepare();
  const source = f.data.items.find(item => item.id === 'ID8auto00').image_link;
  f.data.photos.set(source, blue);
  const second = await f.service.prepare();
  assert.equal(second.valid, true); assert.equal(f.preparations.length, 2);
  assert.notEqual(second.imageBindings.ID8auto00.sourceHash, first.imageBindings.ID8auto00.sourceHash);
});

test('source changes during preparation prevent publishing a stale price or an obsolete vehicle set', async () => {
  const f = fixture({ autoCount: 1, preparePhoto: async () => {
    f.data.items.find(item => item.id === 'ID8auto00').price = '20990.00 EUR';
    return { status: 'prepared', buffer: red };
  } });
  const result = await f.service.prepare();
  assert.equal(result.valid, false); assert.equal(result.reason, 'catalog_source_changed');
  assert.equal(f.blob.records.has(STATE), false);
  const recovered = await f.service.prepare();
  assert.equal(recovered.valid, true); assert.equal(f.preparations.length, 1);
  assert.equal(recovered.items.find(item => item.id === 'ID8auto00').price, '20990.00 EUR');
});

test('missing snapshots allow raw fallback, but partial, corrupt or unreadable snapshots never do', async () => {
  const f = fixture(); const raw = await f.service.audit();
  assert.equal(raw.valid, true); assert.equal(raw.feedHash, f.raw().feedHash); assert.equal(raw.imageSummary.pending, 2);
  await assert.rejects(() => f.service.feed('latest'), { code: 'catalog_snapshot_not_found' });
  await assert.rejects(() => f.service.feed('0'.repeat(64)), { code: 'catalog_snapshot_not_found' });
  const result = await f.service.prepare(); const path = `catalog-feed/v1/production/snapshots/${result.feedHash}.csv`;
  const record = f.blob.records.get(path); f.blob.records.set(path, { ...record, text: Buffer.from('corrupt') });
  await assert.rejects(() => f.service.feed('latest'), { code: 'catalog_snapshot_invalid' });
  assert.equal((await f.service.audit()).valid, false);
  f.blob.records.set(path, record);
  const manifestPath = path.replace(/\.csv$/, '.json'); const manifest = f.blob.records.get(manifestPath);
  f.blob.records.delete(manifestPath);
  await assert.rejects(() => f.service.feed(result.feedHash), { code: 'catalog_snapshot_invalid' });
  f.blob.records.set(manifestPath, manifest);
  f.blob.faults.get = requested => requested === path;
  await assert.rejects(() => f.service.feed(result.feedHash));
});

test('permanent images reject wrong IDs, corrupt bytes and forged source bindings', async () => {
  const f = fixture(); const result = await f.service.prepare(); const binding = result.imageBindings.ID8auto00;
  await assert.rejects(() => f.service.image('ID8foreign', binding.outputHash), { code: 'catalog_image_not_found' });
  await assert.rejects(() => f.service.image('../state', binding.outputHash), { code: 'catalog_image_invalid' });
  const assetPath = `catalog-images/v1/production/assets/${binding.outputHash}.png`;
  const asset = f.blob.records.get(assetPath); f.blob.records.set(assetPath, { ...asset, text: blue });
  await assert.rejects(() => f.service.image(binding.id, binding.outputHash), { code: 'catalog_image_asset_invalid' });
  f.blob.records.set(assetPath, asset);
  const jobPath = `catalog-images/v1/production/jobs/${binding.jobKey}.json`;
  const job = f.blob.records.get(jobPath); const value = JSON.parse(job.text); value.sourceHash = '0'.repeat(64);
  f.blob.records.set(jobPath, { ...job, text: JSON.stringify(value) });
  await assert.rejects(() => f.service.feed(result.feedHash), { code: 'catalog_image_manifest_invalid' });
});

test('invalid or unavailable original images keep the original URL and never call the processor', async () => {
  for (const mode of ['redirect', 'oversized', 'wrong-type']) {
    const f = fixture({ fetchImpl: async () => mode === 'redirect' ? new Response('', { status: 302, headers: { location: 'https://attacker.invalid/image' } })
      : new Response(red, { headers: { 'content-type': mode === 'wrong-type' ? 'text/html' : 'image/png',
        ...(mode === 'oversized' ? { 'content-length': String(8 * 1024 * 1024 + 1) } : {}) } }) });
    const result = await f.service.prepare();
    assert.equal(result.valid, true); assert.equal(result.items.length, 3); assert.equal(result.imageSummary.failed, 2);
    assert.equal(f.preparations.length, 0); assert.equal(result.feedHash, f.raw().feedHash);
  }
});
