import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInstagramPublisher, loadInstagramFeed } from '../lib/instagram-publisher.js';
import { createInstagramStories } from '../lib/instagram-stories.js';
import { createInstagramRetirements } from '../lib/instagram-retirements.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const publicationPath = 'instagram/v1/production/state.json';
const storyPath = 'instagram/v1/production/stories.json';
const env = {
  VERCEL_ENV: 'production', INSTAGRAM_SYNC_ENABLED: 'true', INSTAGRAM_STORIES_ENABLED: 'true', INSTAGRAM_RETIREMENTS_ENABLED: 'true',
  INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_LOGIN_MODE: 'instagram', INSTAGRAM_ACCESS_TOKEN: 'synthetic-only',
  INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic-source/export?format=csv&gid=0',
  INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app', ADMIN_SESSION_SECRET: 'synthetic-secret-with-at-least-32-characters',
  INSTAGRAM_RETIREMENTS_USER_ID: '17841499990000000', INSTAGRAM_RETIREMENTS_PAGE_ID: '99111100000000',
  INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-facebook-only', INSTAGRAM_RETIREMENTS_GRAPH_VERSION: 'v27.0',
};
const sourceHash = createHash('sha256').update(env.INSTAGRAM_FEED_URL).digest('hex');
const car = (id, overrides = {}) => ({ id, title: 'Tesla Model 3', description: '2022 | 42 000 km | Elétrico', availability: 'in stock',
  condition: 'used', price: '31990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/tesla-${id}.html`,
  image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;q=100;s=600x0`, brand: 'Tesla', ...overrides });
function fixture() {
  const memory = memoryBlob(); const calls = [];
  const old = { status: 'published', mediaId: '80000000', updatedAt: '2026-11-17T08:00:00.000Z' };
  const state = { version: 1, accountId: env.INSTAGRAM_USER_ID, username: 'autovalorpt', loginMode: 'instagram', sourceHash,
    initializedAt: '2026-11-01T08:00:00.000Z', lastFeedCount: 1, items: { ID8old001: old }, active: null };
  memory.records.set(publicationPath, { text: JSON.stringify(state), etag: 'seed' });
  const fetchImpl = async (address, settings = {}) => {
    const url = new URL(address); const method = settings.method || 'GET'; calls.push({ url, method });
    assert.ok(['graph.instagram.com', 'graph.facebook.com'].includes(url.hostname), 'The new provider must not fetch Google Sheets');
    if (url.pathname.endsWith('/me/permissions')) return Response.json({ data: ['instagram_basic', 'instagram_manage_contents', 'pages_read_engagement'].map(permission => ({ permission, status: 'granted' })) });
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_PAGE_ID}`)) return Response.json({ id: env.INSTAGRAM_RETIREMENTS_PAGE_ID, instagram_business_account: { id: env.INSTAGRAM_RETIREMENTS_USER_ID, username: 'autovalorpt' } });
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_USER_ID}`)) return Response.json({ id: env.INSTAGRAM_RETIREMENTS_USER_ID, username: 'autovalorpt' });
    if (url.pathname.endsWith('/content_publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100, quota_duration: 86400 } }] });
    if (url.pathname.endsWith('/stories')) return Response.json({ data: [] });
    if (url.pathname.endsWith('/me')) return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: 'autovalorpt', account_type: 'BUSINESS' });
    if (url.pathname.endsWith('/media') && method === 'GET') return Response.json({ data: [{ id: '88000001', caption: car('ID8old001').link, permalink: 'https://www.instagram.com/p/OldPost01/' }] });
    if (url.pathname.endsWith('/media') && method === 'POST') return Response.json({ id: '90000001' });
    if (url.pathname.endsWith('/media_publish')) return Response.json({ id: '80000001' });
    if (url.pathname.endsWith('/90000001')) return Response.json({ status_code: 'FINISHED' });
    throw new Error(`Unexpected provider request ${method} ${url.pathname}`);
  };
  return { memory, calls, old, options: { env, storage: memory.storage, fetchImpl,
    tokenManager: { resolve: async () => 'synthetic-only', status: async () => ({ ready: true }) }, pause: async () => {}, pollAttempts: 0 } };
}

test('new internal feed preserves old ledger binding and publishes a new vehicle only once', async () => {
  const f = fixture(); let reads = 0;
  const publisher = createInstagramPublisher({ ...f.options, loadFeed: async () => { reads++; return [car('ID8old001'), car('ID8new001')]; } });
  const first = await publisher.run();
  assert.equal(first.status, 'published'); assert.equal(first.id, 'ID8new001'); assert.equal(first.published, 1);
  assert.equal((await publisher.run()).status, 'no_new_stock');
  const saved = JSON.parse(f.memory.records.get(publicationPath).text);
  assert.equal(saved.sourceHash, sourceHash);
  assert.equal(saved.initializedAt, '2026-11-01T08:00:00.000Z');
  assert.deepEqual(saved.items.ID8old001, f.old);
  assert.equal(saved.items.ID8new001.status, 'published');
  assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/media_publish')).length, 1);
  assert.equal(reads, 2);
});

test('provider rows receive strict feed validation and never carry additional private fields', async () => {
  const original = car('ID8live01', { description: 'Linha com "aspas", vírgulas e\nquebra', privateToken: 'must-be-discarded' });
  const items = await loadInstagramFeed({ loadFeed: async () => [original] });
  assert.equal(items[0].description, original.description);
  assert.equal(Object.hasOwn(items[0], 'privateToken'), false);
  assert.notEqual(items[0], original);
  for (const invalid of [[], [car('ID8live01'), car('ID8live01')], [car('ID8live01', { price: 'free' })], [car('ID8live01', { image_link: 'https://internal.invalid/image.png' })], [car('ID8live01', { brand: undefined })]]) {
    await assert.rejects(loadInstagramFeed({ loadFeed: async () => invalid }), error => error.code.startsWith('feed_'));
  }
});

test('malformed provider aborts photo and Story services before requests or writes', async () => {
  for (const create of [createInstagramPublisher, createInstagramStories]) {
    const f = fixture(); const before = f.memory.records.get(publicationPath).text;
    const service = create({ ...f.options, loadFeed: async () => [car('ID8live01'), car('ID8live01')] });
    await assert.rejects(service.run(), { code: 'feed_invalid_item' });
    assert.equal(f.calls.length, 0);
    assert.equal(f.memory.calls.filter(call => call.method === 'put').length, 0);
    assert.equal(f.memory.records.get(publicationPath).text, before);
  }
});

test('Story plans from new provider reuse existing publication and Story histories', async () => {
  const f = fixture();
  const ledger = { version: 1, accountId: env.INSTAGRAM_USER_ID, facebookId: env.INSTAGRAM_RETIREMENTS_USER_ID,
    pageId: env.INSTAGRAM_RETIREMENTS_PAGE_ID, sourceHash, publicationProvider: 'instagram',
    initializedAt: '2026-11-01T08:00:00.000Z', lastFeedCount: 1, active: null, items: { ID8old001: { status: 'expired', at: '2026-11-16T08:00:00.000Z' } } };
  f.memory.records.set(storyPath, { text: JSON.stringify(ledger), etag: 'stories-seed' });
  const stories = createInstagramStories({ ...f.options, loadFeed: async () => [car('ID8old001'), car('ID8new001')] });
  const result = await stories.dryRun();
  assert.equal(result.wouldInitializeBaseline, false);
  assert.deepEqual(result.candidates, ['ID8new001']);
  assert.deepEqual(JSON.parse(f.memory.records.get(storyPath).text), ledger);
  assert.equal(f.calls.some(call => call.method !== 'GET'), false);
});

test('the archive preserves published vehicles regardless of subsequent availability', async () => {
  const f = fixture();
  for (const availability of ['out of stock', 'in stock']) {
    let reads = 0;
    const retirement = createInstagramRetirements({ ...f.options, loadFeed: async () => {
      reads++; return [car('ID8old001', { availability })];
    } });
    assert.deepEqual(await retirement.run(), { ok: true, status: 'disabled', retired: 0 });
    assert.equal(reads, 0);
  }
  assert.deepEqual(JSON.parse(f.memory.records.get(publicationPath).text).items.ID8old001, f.old);
  assert.deepEqual(f.memory.calls, []);
  assert.deepEqual(f.calls, []);
});
