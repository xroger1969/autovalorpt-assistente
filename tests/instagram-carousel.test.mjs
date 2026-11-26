import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramPublisher, instagramPhotoUrls, loadInstagramFeed, parseInstagramFeed } from '../lib/instagram-publisher.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const STATE = 'instagram/v1/production/state.json';
const headers = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const image = name => `https://ireland.apollo.olxcdn.com/v1/files/${name}/image`;
const car = (id, photos = 1, overrides = {}) => ({ id, title: 'Peugeot e-2008', description: 'Elétrico. 2021. 119 980 km.',
  availability: 'in stock', condition: 'used', price: '17990.00 EUR',
  link: `https://www.standvirtual.com/carros/anuncio/peugeot-${id}.html`, image_link: image(`${id}-1`), brand: 'Peugeot',
  ...(photos > 1 ? { additional_image_link: Array.from({ length: photos - 1 }, (_, i) => image(`${id}-${i + 2}`)).join(',') } : {}), ...overrides });
const csv = (items, gallery = true) => {
  const columns = gallery ? [...headers, 'additional_image_link'] : headers;
  return [columns, ...items.map(item => columns.map(key => item[key] ?? ''))]
    .map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
};

function fixture(options = {}) {
  const memory = memoryBlob(); const calls = [];
  const env = { VERCEL_ENV: 'production', INSTAGRAM_SYNC_ENABLED: 'true', INSTAGRAM_ACCESS_TOKEN: 'synthetic-gallery-token',
    INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_GRAPH_VERSION: 'v26.0',
    INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic-gallery/export?format=csv',
    ADMIN_SESSION_SECRET: 'synthetic-gallery-secret-long-enough-only', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app' };
  let items = [car('ID8base01')]; let nextContainer = 900000;
  let childStatus = 'FINISHED'; let parentStatus = 'FINISHED'; let publishUnknown = false; let createFail = false; let clock = Date.now();
  const children = new Set();
  const state = () => JSON.parse(memory.records.get(STATE).text);
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url); const body = new URLSearchParams(init.body);
    calls.push({ url, method: init.method, body });
    assert.equal(init.headers.Authorization, `Bearer ${env.INSTAGRAM_ACCESS_TOKEN}`);
    if (parsed.pathname.endsWith('/me')) return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: 'autovalorpt' });
    if (parsed.pathname.endsWith('/media')) {
      const active = state().active;
      if (createFail) return Response.json({ error: { code: 100, message: 'Never expose raw details.' } }, { status: 400 });
      const id = String(++nextContainer);
      if (body.get('media_type') === 'CAROUSEL') {
        assert.equal(active.phase, 'creating_carousel');
        assert.equal(body.has('image_url'), false);
        assert.deepEqual(body.get('children').split(','), active.childContainerIds);
      } else if (body.get('is_carousel_item') === 'true') {
        assert.equal(active.phase, 'creating_children');
        assert.equal(body.has('caption'), false);
        children.add(id);
      } else assert.equal(active.phase, 'creating');
      return Response.json({ id });
    }
    if (parsed.pathname.endsWith('/media_publish')) {
      assert.equal(state().active.phase, 'publishing');
      assert.equal(body.get('creation_id'), state().active.containerId);
      assert.equal(children.has(body.get('creation_id')), false);
      if (publishUnknown) throw new Error('Synthetic lost publication response');
      return Response.json({ id: '80000123' });
    }
    const id = parsed.pathname.split('/').at(-1);
    return Response.json({ status_code: children.has(id) ? childStatus : parentStatus });
  };
  const publisher = createInstagramPublisher({ env, storage: memory.storage, fetchImpl, loadFeed: async () => items,
    tokenManager: { resolve: async () => env.INSTAGRAM_ACCESS_TOKEN, status: async () => ({}) }, now: () => clock,
    pollAttempts: 0, pause: async () => {}, ...(options.batch ? { maxCarouselChildrenPerRun: options.batch } : {}) });
  return { publisher, memory, calls, state, setItems: value => { items = value; },
    childStatus: value => { childStatus = value; }, parentStatus: value => { parentStatus = value; },
    failPublish: value => { publishUnknown = value; }, failCreate: value => { createFail = value; },
    advance: ms => { clock += ms; },
    creates: () => calls.filter(call => call.url.endsWith('/media')),
    publishes: () => calls.filter(call => call.url.endsWith('/media_publish')) };
}

test('legacy feeds preserve their exact row shape; the optional gallery column round-trips original URLs', async () => {
  const legacy = car('ID8base01');
  assert.deepEqual(parseInstagramFeed(csv([legacy], false)), [legacy]);
  assert.equal(Object.hasOwn(parseInstagramFeed(csv([legacy], false))[0], 'additional_image_link'), false);
  const current = car('ID8new001', 21);
  assert.deepEqual(parseInstagramFeed(csv([current])), [current]);
  const parsed = await loadInstagramFeed({ loadFeed: async () => [{ ...current, privateToken: 'discard-me' }, legacy] });
  assert.equal(parsed[0].additional_image_link, current.additional_image_link);
  assert.equal(parsed[1].additional_image_link, '');
  assert.equal(Object.hasOwn(parsed[0], 'privateToken'), false);
});

test('gallery input validates every additional URL and count before any publication', () => {
  for (const extra of ['https://example.com/photo.jpg', image('allowed') + ',https://127.0.0.1/photo', image('allowed') + ',', ',']) {
    assert.throws(() => parseInstagramFeed(csv([car('ID8new001', 1, { additional_image_link: extra })])), { code: 'feed_invalid_item' });
  }
  assert.throws(() => parseInstagramFeed(csv([car('ID8new001', 22)])), { code: 'feed_invalid_item' });
  assert.throws(() => parseInstagramFeed(csv([car('ID8new001', 2)]).replace('additional_image_link', 'untrusted_images')), { code: 'feed_invalid_headers_or_count' });
  const duplicate = car('ID8new001', 1, { additional_image_link: [image('ID8new001-1') + ';s=640x480', image('interior'), image('interior')].join(',') });
  assert.deepEqual(instagramPhotoUrls(duplicate), [duplicate.image_link, image('interior')]);
});

test('a new vehicle publishes ordered original photos in one carousel, preserving its caption and history', async () => {
  const f = fixture(); await f.publisher.run();
  f.setItems([car('ID8base01'), car('ID8new001', 3)]);
  const before = f.memory.records.get(STATE).text;
  const dry = await f.publisher.dryRun();
  assert.equal(dry.nextPost.imageCount, 3);
  assert.deepEqual(dry.nextPost.imageUrls, [1, 2, 3].map(n => image(`ID8new001-${n}`)));
  assert.equal(f.memory.records.get(STATE).text, before);
  const result = await f.publisher.run();
  assert.equal(result.status, 'published'); assert.equal(result.mediaType, 'CAROUSEL'); assert.equal(result.imageCount, 3);
  const creates = f.creates();
  assert.equal(creates.length, 4);
  assert.deepEqual(creates.slice(0, 3).map(call => new URL(call.body.get('image_url')).searchParams.get('src')), [1, 2, 3].map(n => image(`ID8new001-${n}`)));
  assert.equal(creates[3].body.get('media_type'), 'CAROUSEL');
  assert.equal(creates[3].body.get('children'), '900001,900002,900003');
  assert.match(creates[3].body.get('caption'), /Peugeot e-2008/);
  assert.match(creates[3].body.get('caption'), /17[\s\u00a0]990/);
  assert.equal(f.publishes().length, 1); assert.equal(f.publishes()[0].body.get('creation_id'), '900004');
  const published = { ...f.state().items.ID8new001 };
  f.setItems([car('ID8base01', 5), car('ID8new001', 5)]);
  assert.equal((await f.publisher.run()).status, 'no_new_stock');
  assert.deepEqual(f.state().items.ID8new001, published);
  assert.equal(f.state().items.ID8base01.status, 'baseline');
  assert.equal(f.publishes().length, 1);
});

test('Instagram caps a carousel at 20 total photos without changing the supplied gallery', async () => {
  const f = fixture(); await f.publisher.run();
  const item = car('ID8new001', 21); const original = item.additional_image_link;
  f.setItems([car('ID8base01'), item]);
  assert.equal((await f.publisher.run()).imageCount, 20);
  assert.equal(f.creates().length, 21);
  assert.equal(f.creates().at(-1).body.get('children').split(',').length, 20);
  assert.equal(item.additional_image_link, original);
});

test('partial preparation resumes stored children and concurrent continuations publish once', async () => {
  const f = fixture({ batch: 2 }); await f.publisher.run();
  f.setItems([car('ID8base01'), car('ID8new001', 3)]);
  assert.equal((await f.publisher.run()).status, 'preparing');
  assert.deepEqual(f.state().active.childContainerIds, ['900001', '900002']);
  f.childStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run()).status, 'preparing');
  assert.equal(f.creates().length, 3); assert.equal(f.publishes().length, 0);
  f.childStatus('FINISHED');
  const results = await Promise.all([f.publisher.run(), f.publisher.run()]);
  assert.equal(results.filter(result => result.status === 'published').length, 1);
  assert.equal(f.creates().length, 4); assert.equal(f.publishes().length, 1);
});

test('a crash after persisting a child resumes the same private gallery after its lease expires', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3)]);
  const put = f.memory.storage.put; let crash = true;
  f.memory.storage.put = async (...args) => {
    const result = await put(...args); const state = JSON.parse(args[1]);
    if (crash && state.active?.phase === 'creating_children' && state.active.childContainerIds.length === 2) { crash = false; throw new Error('Lost checkpoint acknowledgement'); }
    return result;
  };
  await assert.rejects(f.publisher.run(), /Lost checkpoint/);
  assert.equal((await f.publisher.run()).status, 'busy');
  assert.equal(f.creates().length, 2); assert.equal(f.publishes().length, 0);
  f.advance(91_000);
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(f.creates().length, 4);
  assert.equal(f.creates().at(-1).body.get('children'), '900001,900002,900003');
  assert.equal(f.publishes().length, 1);
});

test('stock changes cancel an unpublished gallery before parent creation', async () => {
  const f = fixture({ batch: 2 }); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3)]);
  await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3, { price: '16990.00 EUR' })]);
  assert.equal((await f.publisher.run()).status, 'canceled');
  assert.equal(f.creates().some(call => call.body.get('media_type') === 'CAROUSEL'), false);
  assert.equal(f.publishes().length, 0);
});

test('an interrupted parent acknowledgement can only orphan a private container', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3)]);
  f.memory.faults.put = (_, state) => state.active?.mediaType === 'CAROUSEL' && state.active?.phase === 'preparing';
  await assert.rejects(f.publisher.run(), /storage write failure/);
  assert.equal(f.state().active.phase, 'creating_carousel');
  assert.equal(f.publishes().length, 0);
  f.memory.faults.put = null; f.advance(91_000);
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(f.creates().filter(call => call.body.get('is_carousel_item') === 'true').length, 3);
  assert.equal(f.creates().filter(call => call.body.get('media_type') === 'CAROUSEL').length, 2);
  assert.equal(f.publishes().length, 1);
});

test('uncertain carousel publication remains blocked and reconciles without a duplicate', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3)]); f.failPublish(true);
  await assert.rejects(f.publisher.run(), { code: 'meta_transport_unknown' });
  f.failPublish(false); f.advance(91_000);
  assert.equal((await f.publisher.run()).status, 'review_required');
  f.parentStatus('PUBLISHED');
  const result = await f.publisher.run(); assert.equal(result.status, 'published'); assert.equal(result.reconciled, true);
  assert.equal(f.creates().length, 4); assert.equal(f.publishes().length, 1);
});

test('a failed child prevents the parent and retries are bounded', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', 3)]); f.failCreate(true);
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await f.publisher.run()).status, 'failed');
  assert.equal((await f.publisher.run()).status, 'no_new_stock');
  assert.equal(f.creates().length, 3); assert.equal(f.publishes().length, 0);
  assert.equal(JSON.stringify(await f.publisher.status()).includes('Never expose raw details'), false);
});
