import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInstagramStories, storyFingerprint } from '../lib/instagram-stories.js';
import { memoryBlob } from './helpers/memory-blob.mjs';
import { BlobNotFoundError } from '@vercel/blob';
import { createManualStoryVideos } from '../lib/manual-story-videos.js';
import { verifyInstagramVideoQuery } from '../lib/instagram-video-access.js';
import { STOCK_INVENTORIES } from '../lib/stock-inventories.js';

const env = { VERCEL_ENV: 'production', ADMIN_SESSION_SECRET: 'local-test-only-key-with-32-characters', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app' };
const photo = key => `https://ireland.apollo.olxcdn.com/v1/files/${key}/image`;
const idA = 'ID8Q1pSL'; const idB = 'ID8Qother';
const bytes = Buffer.alloc(1024, 10);

function advert(id, make, model, plate) {
  return { url: `https://www.standvirtual.com/carros/anuncio/anuncio-${id}.html`, title: `${make} ${model}`,
    photos: [photo(id), photo(`${id}-rear`)], price: { grossMinorAmount: 1699000, currencyCode: 'EUR' },
    attributes: [
      { key: 'make', valueLabel: make }, { key: 'model', valueLabel: model }, { key: 'new_used', value: 'used' },
      { key: 'first_registration_year', value: '2020' }, { key: 'mileage', value: '60000' },
      { key: 'fuel_type', valueLabel: 'Elétrico' }, ...(plate ? [{ key: 'registration_number', value: plate }] : []),
    ] };
}

function fixture(options = {}) {
  const inventories = [[advert(idA, 'Renault', 'ZOE', 'AA-44-AA')], [advert(idB, 'Tesla', 'Model 3')]];
  const files = new Map(); const calls = { fetch: [], render: [], head: [], put: [] };
  const storage = {
    async head(path) {
      calls.head.push(path);
      if (!files.has(path)) throw new BlobNotFoundError();
      return { size: files.get(path).length, contentType: 'video/mp4' };
    },
    async put(path, buffer, settings) {
      calls.put.push(path); assert.equal(settings.allowOverwrite, false); assert.equal(settings.access, 'private');
      assert.ok(!files.has(path)); files.set(path, buffer);
    },
  };
  const setup = {
    env, storage,
    fetchImpl: async (url, init) => {
      calls.fetch.push(url); assert.equal(init.method || 'GET', 'GET');
      const ads = inventories[STOCK_INVENTORIES.findIndex(source => source.url === url)];
      const page = { numberOfActiveAdverts: ads.length, urqlState: { a: { data: { publishedAds: { total: ads.length, ads } } } } };
      return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: page } })}</script>`, { headers: { 'content-type': 'text/html' } });
    },
    renderVideo: async (item) => {
      calls.render.push(item); await options.afterRender?.(inventories);
      return { width: 1080, height: 1920, duration: 30, buffer: bytes, completeGallery: options.completeGallery ?? true };
    },
  };
  return { inventories, files, calls, setup, videos: createManualStoryVideos(setup) };
}

test('manual selector reads both validated live inventories, exact original facts, no publication or Blob access', async () => {
  const { videos, inventories, calls } = fixture();
  inventories[1].push(inventories[0][0]);
  const { items } = await videos.list();
  const car = items.find(x => x.id === idA);
  assert.deepEqual(car, { id: idA, title: 'Renault ZOE', brand: 'Renault', model: 'ZOE', price: '16990.00 EUR',
    image: `${photo(idA)};s=320x0`, sources: ['Samucar', 'AutoValorPT'], plate: 'AA-44-AA' });
  assert.equal(items.find(x => x.id === idB).plate, null);
  assert.equal(calls.fetch.length, 2); assert.deepEqual(calls.head, []); assert.deepEqual(calls.put, []);
  inventories[0] = []; inventories[1].pop();
  assert.deepEqual((await videos.list()).items.map(x => x.id), [idB]);
});

test('manual preview renders either inventory using pinned originals, signs MP4 URLs, reuses unchanged assets independently of automation', async () => {
  const { setup, videos, calls, files } = fixture();
  for (const id of [idA, idB]) {
    const result = await videos.preview(id);
    assert.equal(result.id, id); assert.equal(result.reused, false); assert.equal(result.status, 'preview_ready');
    for (const url of [result.videoUrl, result.downloadUrl]) {
      const path = verifyInstagramVideoQuery(Object.fromEntries(new URL(url).searchParams), env);
      assert.ok(files.has(path)); assert.match(path, /\/videos\/ID\w+-[0-9a-f]{64}\.mp4$/);
    }
    assert.equal(new URL(result.downloadUrl).searchParams.get('download'), '1');
    assert.deepEqual(calls.render.at(-1).image_links, [`${photo(id)};s=1440x0`, `${photo(id + '-rear')};s=1440x0`]);
    assert.equal((await videos.validate(id, result.fingerprint)).id, id);
    assert.equal((await createManualStoryVideos(setup).preview(id)).reused, true);
  }
  assert.equal(calls.render.length, 2); assert.equal(calls.put.length, 2);
  assert.ok(calls.head.concat(calls.put).every(path => path.includes('/videos/')));
});

test('price and secondary-photo changes invalidate prior review, preserve every immutable MP4, and sold cars cannot publish', async () => {
  const { videos, files, inventories } = fixture(); const first = await videos.preview(idA);
  inventories[0][0].photos[1] = photo('new-rear');
  await assert.rejects(videos.validate(idA, first.fingerprint), { code: 'stock_changed_before_publication' });
  const second = await videos.preview(idA); assert.notEqual(first.fingerprint, second.fingerprint);
  inventories[0][0].price.grossMinorAmount += 20000;
  const third = await videos.preview(idA); assert.notEqual(third.fingerprint, second.fingerprint);
  assert.equal(files.size, 3); inventories[0] = [];
  await assert.rejects(videos.preview(idA), { code: 'story_vehicle_unavailable' });
  await assert.rejects(videos.validate(idA, third.fingerprint), { code: 'story_vehicle_unavailable' });
  assert.equal(files.size, 3);
});

test('changed source during rendering cannot confirm a stale preview or write an asset', async () => {
  const { videos, files } = fixture({ afterRender: inv => { inv[0][0].photos[1] = photo('edited'); } });
  await assert.rejects(videos.preview(idA), { code: 'stock_changed_during_render' });
  assert.equal(files.size, 0);
});

test('overlapping requests coalesce in the same instance, an untrusted gallery blocks rendering', async () => {
  const { videos, calls, inventories } = fixture();
  const [one, two] = await Promise.all([videos.preview(idA), videos.preview(idA)]);
  assert.equal(one.fingerprint, two.fingerprint); assert.equal(calls.render.length, 1);
  inventories[1][0].photos[1] = 'https://example.org/foreign.jpg';
  await assert.rejects(videos.preview(idB), { code: 'source_invalid_vehicle' });
  assert.equal(calls.render.length, 1);
});

test('automatic and manual previews share a single complete asset in either order while retaining separate eligibility', async () => {
  for (const first of ['manual', 'auto', 'partial auto']) {
    const { videos, setup, calls } = fixture({ completeGallery: first !== 'partial auto' });
    const ledger = memoryBlob();
    const settings = { ...env, INSTAGRAM_USER_ID: '12345678901234', INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/test/export?format=csv&gid=0' };
    const row = { id: idA, title: 'Renault ZOE | 2020 | 60 000 km', description: 'Renault ZOE. Elétrico. 2020. 60 000 km.',
      availability: 'in stock', condition: 'used', price: '16990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/anuncio-${idA}.html`,
      image_link: photo(idA), brand: 'Renault' };
    const publication = { version: 1, accountId: settings.INSTAGRAM_USER_ID, username: 'autovalorpt', loginMode: 'instagram',
      sourceHash: createHash('sha256').update(settings.INSTAGRAM_FEED_URL).digest('hex'),
      lastResult: { status: 'published', id: idA }, items: { [idA]: { status: 'published', mediaId: '23456789', updatedAt: new Date().toISOString() } } };
    ledger.records.set('instagram/v1/production/state.json', { etag: 'initial', text: JSON.stringify(publication) });
    const storage = { get: ledger.storage.get,
      head: (path, opts) => (path.endsWith('.mp4') ? setup.storage : ledger.storage).head(path, opts),
      put: (path, value, opts) => (path.endsWith('.mp4') ? setup.storage : ledger.storage).put(path, value, opts) };
    const auto = createInstagramStories({ ...setup, env: settings, storage, loadFeed: async () => [row] });
    const a = first === 'manual' ? await videos.preview(idA) : await auto.preview(idA);
    const b = first === 'manual' ? await auto.preview(idA) : await videos.preview(idA);
    const autoPreview = first === 'manual' ? b : a;
    assert.equal(autoPreview.fingerprint, storyFingerprint(row));
    if (first === 'partial auto') {
      assert.notEqual(new URL(a.videoUrl).searchParams.get('fingerprint'), b.fingerprint);
      assert.equal(calls.render.length, 2);
    } else {
      assert.equal(new URL(a.videoUrl).searchParams.get('fingerprint'), new URL(b.videoUrl).searchParams.get('fingerprint'));
      assert.equal(calls.render.length, 1); assert.equal(calls.put.length, 1);
    }
  }
});
