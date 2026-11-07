import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { createInstagramPublisher, instagramCaption, parseInstagramFeed } from '../lib/instagram-publisher.js';
import { createInstagramSyncHandler } from '../lib/instagram-sync-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const headers = ['id','title','description','availability','condition','price','link','image_link','brand'];
const car = (id, overrides = {}) => ({ id, title: 'Tesla Model 3', description: '2022 | 42 000 km', availability: 'in stock', condition: 'used', price: '22990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/tesla-${id}.html`, image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;q=100;s=600x0`, brand: 'Tesla', ...overrides });
const csv = (items) => [headers, ...items.map((item) => headers.map((key) => item[key]))].map((row) => row.map((v) => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
function fixture(options = {}) {
  const memory = memoryBlob(); const calls = [];
  const env = { VERCEL_ENV: 'production', INSTAGRAM_SYNC_ENABLED: 'true', INSTAGRAM_ACCESS_TOKEN: 'synthetic-token-only', INSTAGRAM_TOKEN_EXPIRES_AT: new Date(Date.now() + 60 * 86400_000).toISOString(), INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_GRAPH_VERSION: 'v26.0', INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic-test/export?format=csv&gid=0', ADMIN_SESSION_SECRET: 'synthetic-secret-with-at-least-32-characters', INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app', CRON_SECRET: 'synthetic-cron-secret-at-least-32-characters', ...options.env };
  let items = [car('ID8base01')]; let rawFeed; let accountName = 'autovalorpt'; let containerStatus = 'FINISHED'; let statusSequence = []; let failPublish = false; let failCreate = false; let containerCount = 0;
  const fetchImpl = async (url, settings) => {
    calls.push({ url, method: settings.method || 'GET', body: settings.body });
    if (url.startsWith('https://docs.google.com/')) return new Response(rawFeed ?? csv(items), { headers: { 'content-type': 'text/csv' } });
    const parsed = new URL(url);
    assert.equal(settings.headers.Authorization, `Bearer ${options.resolvedToken || env.INSTAGRAM_ACCESS_TOKEN}`);
    assert.equal(parsed.searchParams.has('access_token'), false);
    if (parsed.pathname.endsWith('/me')) return Response.json({ user_id: env.INSTAGRAM_USER_ID, username: accountName });
    if (parsed.pathname.endsWith(`/${env.INSTAGRAM_USER_ID}`)) return Response.json({ id: env.INSTAGRAM_USER_ID, username: accountName });
    if (parsed.pathname.endsWith('/media')) {
      const persisted = JSON.parse(memory.records.get('instagram/v1/production/state.json').text);
      assert.equal(persisted.active.phase, 'creating');
      assert.match(new URLSearchParams(settings.body).get('image_url'), /\/api\/stock\?integration=instagram-image&src=/);
      if (failCreate) return Response.json({ error: { code: 100, message: 'provider raw body must not leak' } }, { status: 400 });
      return Response.json({ id: String(900000 + ++containerCount) });
    }
    if (parsed.pathname.endsWith('/media_publish')) {
      assert.equal(JSON.parse(memory.records.get('instagram/v1/production/state.json').text).active.phase, 'publishing');
      if (failPublish) throw new Error('synthetic timeout with secret must not leak');
      return Response.json({ id: '80000001' });
    }
    return Response.json({ status_code: statusSequence.shift() || containerStatus });
  };
  let clock = Date.now();
  const publisher = createInstagramPublisher({ env, fetchImpl, storage: memory.storage, now: () => clock, pollAttempts: options.pollAttempts || 0, pause: async () => {},
    ...(options.resolvedToken ? { tokenManager: { resolve: async () => options.resolvedToken, status: async () => ({ automaticRefresh: true }) } } : {}) });
  return { publisher, memory, calls, env, advance: (ms) => { clock += ms; }, setItems: (next) => { items = next; }, setRawFeed: (next) => { rawFeed = next; }, setAccount: (next) => { accountName = next; }, setContainerStatus: (next) => { containerStatus = next; }, setStatusSequence: (next) => { statusSequence = next; }, setFailPublish: (next) => { failPublish = next; }, setFailCreate: (next) => { failCreate = next; } };
}

test('first run baselines current stock without creating or publishing media', async () => {
  const f = fixture(); f.setItems(Array.from({ length: 11 }, (_, i) => car(`ID8base${String(i).padStart(2,'0')}`)));
  assert.deepEqual(await f.publisher.run(), { ok: true, status: 'baseline_initialized', count: 11, published: 0 });
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal((await f.publisher.status()).counts.baseline, 11);
});

test('a real SDK lease conflict does not create or publish any media', async () => {
  const f = fixture({ env: { INSTAGRAM_INCLUDE_EXISTING_STOCK: 'true' } });
  await f.publisher.run();
  f.memory.faults.put = () => { throw new BlobPreconditionFailedError(); };
  assert.equal((await f.publisher.run()).status, 'busy');
  assert.equal(f.calls.filter((call) => call.method === 'POST').length, 0);
});

test('caption preserves exact cents without inventing commercial conditions', () => {
  assert.match(instagramCaption(car('ID8new001', { price: '22990.45 EUR' })), /22[\s\u00a0]990,45/);
  assert.doesNotMatch(instagramCaption(car('ID8new001')), /garantia|financiamento|desconto/i);
});

test('opted-in existing stock publishes one per run without resetting history or repeating posts', async () => {
  const f = fixture({ env: { INSTAGRAM_INCLUDE_EXISTING_STOCK: 'true' } });
  f.setItems(Array.from({ length: 11 }, (_, i) => car(`ID8base${String(i).padStart(2,'0')}`)));
  await f.publisher.run();
  const before = [...f.memory.records.entries()].map(([key, value]) => [key, value.text]);
  const dry = await f.publisher.dryRun();
  assert.equal(dry.configuration.includeExistingStock, true);
  assert.equal(dry.candidateCount, 11);
  assert.deepEqual([...f.memory.records.entries()].map(([key, value]) => [key, value.text]), before);
  const published = [];
  for (let i = 0; i < 11; i++) {
    const result = await f.publisher.run();
    assert.equal(result.status, 'published');
    assert.equal(result.published, 1);
    published.push(result.id);
  }
  assert.equal(new Set(published).size, 11);
  assert.equal((await f.publisher.run()).status, 'no_new_stock');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 11);
  assert.equal((await f.publisher.status()).counts.published, 11);
});

test('existing stock stays excluded by default and opt-in still excludes sold or removed cars', async () => {
  const off = fixture(); await off.publisher.run();
  assert.equal((await off.publisher.dryRun()).candidateCount, 0);
  assert.equal((await off.publisher.run()).status, 'no_new_stock');
  const f = fixture({ env: { INSTAGRAM_INCLUDE_EXISTING_STOCK: 'true' } });
  f.setItems([car('ID8base01'), car('ID8base02'), car('ID8base03')]);
  await f.publisher.run();
  f.setItems([car('ID8base02', { availability: 'out of stock' }), car('ID8base03', { price: '21990.00 EUR' })]);
  assert.equal((await f.publisher.dryRun()).candidateCount, 1);
  assert.equal((await f.publisher.run()).id, 'ID8base03');
  const create = f.calls.find((c) => c.url.endsWith('/media'));
  assert.match(new URLSearchParams(create.body).get('caption'), /21[\s\u00a0]990/);
  assert.equal((await f.publisher.run()).status, 'no_new_stock');
});

test('publishes one new in-stock ID and never republishes it, including concurrent runs', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]);
  const results = await Promise.all([f.publisher.run(), f.publisher.run()]);
  assert.equal(results.filter((r) => r.status === 'published').length, 1);
  await f.publisher.run();
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
  assert.equal((await f.publisher.status()).counts.published, 1);
});

test('does not publish out-of-stock rows or a removed pending vehicle', async () => {
  const f = fixture(); await f.publisher.run(); f.setContainerStatus('IN_PROGRESS');
  f.setItems([car('ID8base01'), car('ID8sold01', { availability: 'out of stock' }), car('ID8new001')]);
  assert.equal((await f.publisher.run()).status, 'preparing');
  f.setItems([car('ID8base01'), car('ID8sold01', { availability: 'out of stock' })]);
  assert.equal((await f.publisher.run()).status, 'canceled');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 0);
});

test('an uncertain publication remains blocked across retries and account status hides credentials', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]); f.setFailPublish(true);
  await assert.rejects(f.publisher.run(), { code: 'meta_transport_unknown' });
  f.setFailPublish(false); f.advance(91_000);
  assert.equal((await f.publisher.run()).status, 'review_required');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
  const status = await f.publisher.status(); assert.equal(status.active.phase, 'unknown');
  assert.equal(JSON.stringify(status).includes(f.env.INSTAGRAM_ACCESS_TOKEN), false);
  assert.equal([...f.memory.records.values()].some((r) => r.text.includes(f.env.INSTAGRAM_ACCESS_TOKEN)), false);
});

test('a lost storage acknowledgement after successful publication cannot cause a duplicate', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]);
  f.memory.faults.put = (_, value) => value.items?.ID8new001?.status === 'published';
  await assert.rejects(f.publisher.run()); f.memory.faults.put = null; f.advance(91_000);
  assert.equal((await f.publisher.run()).status, 'review_required');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
});

test('resumed preparing containers use CAS to prevent concurrent media_publish', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]); f.setContainerStatus('IN_PROGRESS');
  assert.equal((await f.publisher.run()).status, 'preparing'); f.setContainerStatus('FINISHED');
  const results = await Promise.all([f.publisher.run(), f.publisher.run()]);
  assert.equal(results.filter((r) => r.status === 'published').length, 1);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
});

test('newly seen sold stock may publish when available; canceled changed stock retries latest data', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001', { availability: 'out of stock' })]);
  assert.equal((await f.publisher.run()).status, 'no_new_stock'); f.setContainerStatus('IN_PROGRESS');
  f.setItems([car('ID8base01'), car('ID8new001')]); assert.equal((await f.publisher.run()).status, 'preparing');
  f.setItems([car('ID8base01'), car('ID8new001', { price: '21990.00 EUR' })]); assert.equal((await f.publisher.run()).status, 'canceled');
  f.setContainerStatus('FINISHED'); assert.equal((await f.publisher.run()).status, 'published');
  const lastCreate = f.calls.filter((c) => c.url.endsWith('/media')).at(-1);
  assert.match(new URLSearchParams(lastCreate.body).get('caption'), /21[\s\u00a0]990/);
});

test('bounded polling publishes ready media in the same run and expired containers can retry', async () => {
  const f = fixture({ pollAttempts: 2 }); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]);
  f.setStatusSequence(['IN_PROGRESS', 'FINISHED']); assert.equal((await f.publisher.run()).status, 'published');
  const second = fixture(); await second.publisher.run(); second.setItems([car('ID8base01'), car('ID8new001')]); second.setContainerStatus('IN_PROGRESS');
  assert.equal((await second.publisher.run()).status, 'preparing'); second.setContainerStatus('EXPIRED');
  assert.equal((await second.publisher.run()).status, 'failed'); second.setContainerStatus('FINISHED');
  assert.equal((await second.publisher.run()).status, 'published');
  assert.equal(second.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
});

test('uncertain published media reconcile by read without a second publication', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]); f.setFailPublish(true);
  await assert.rejects(f.publisher.run()); f.advance(91_000); f.setContainerStatus('PUBLISHED'); f.setFailPublish(false);
  const result = await f.publisher.run(); assert.equal(result.status, 'published'); assert.equal(result.reconciled, true);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
});

test('container creation errors retry at most three times and expose only safe numeric diagnostics', async () => {
  const f = fixture(); await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]); f.setFailCreate(true);
  for (let i = 0; i < 3; i++) assert.equal((await f.publisher.run()).status, 'failed');
  assert.equal((await f.publisher.run()).status, 'no_new_stock');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media')).length, 3);
  const status = await f.publisher.status(); assert.equal(status.lastResult.metaCode, 100); assert.equal(status.lastResult.metaStatus, 400);
  assert.equal(JSON.stringify(status).includes('provider raw body'), false);
});

test('malformed, duplicated and suspiciously partial feeds fail before publishing', async () => {
  assert.throws(() => parseInstagramFeed(csv([car('ID8new001')]) + '\n"incomplete'), { code: 'feed_truncated_csv' });
  assert.throws(() => parseInstagramFeed(csv([car('ID8new001'), car('ID8new001')])), { code: 'feed_invalid_item' });
  const f = fixture(); f.setItems(Array.from({ length: 11 }, (_, i) => car(`ID8base${String(i).padStart(2,'0')}`))); await f.publisher.run();
  f.setItems([car('ID8new001')]); await assert.rejects(f.publisher.run(), { code: 'feed_suspiciously_incomplete' });
  f.setRawFeed(`${csv([car('ID8new001')])}\nIDtruncated,missing`); await assert.rejects(f.publisher.run(), { code: 'feed_incomplete_row' });
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
});

test('disabled, preview, missing credentials and wrong account never publish', async () => {
  const disabled = fixture({ env: { INSTAGRAM_SYNC_ENABLED: 'false' } }); assert.equal((await disabled.publisher.run()).status, 'disabled'); assert.equal(disabled.calls.length, 0);
  const missing = fixture({ env: { INSTAGRAM_ACCESS_TOKEN: '' } }); await assert.rejects(missing.publisher.run(), { code: 'instagram_not_configured' }); assert.equal(missing.calls.length, 0);
  const preview = fixture({ env: { VERCEL_ENV: 'preview' } }); await assert.rejects(preview.publisher.run(), { code: 'production_required' });
  const wrong = fixture(); wrong.setAccount('another_business'); await assert.rejects(wrong.publisher.run(), { code: 'wrong_instagram_account' }); assert.equal(wrong.memory.records.size, 0);
});

test('dry run is read-only and Facebook login selects the correct Graph host', async () => {
  const f = fixture({ env: { INSTAGRAM_LOGIN_MODE: 'facebook' } });
  assert.equal((await f.publisher.dryRun()).wouldInitializeBaseline, true); assert.equal(f.memory.records.size, 0);
  await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]); const dry = await f.publisher.dryRun();
  assert.equal(dry.candidateCount, 1); assert.match(dry.nextPost.caption, /Tesla Model 3/);
  assert.equal(f.calls.filter((c) => c.method === 'POST').length, 0);
  assert.ok(f.calls.some((c) => c.url.startsWith('https://graph.facebook.com/v26.0/')));
});

test('publisher uses the resolved renewed token for account, creation, status and publication', async () => {
  const f = fixture({ resolvedToken: 'synthetic-renewed-authorization-only' });
  await f.publisher.run(); f.setItems([car('ID8base01'), car('ID8new001')]);
  assert.equal((await f.publisher.run()).status, 'published');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/media_publish')).length, 1);
});

test('private endpoint rejects anonymous/GET admin mutations, accepts authenticated cron', async () => {
  const f = fixture(); let runs = 0;
  const handler = createInstagramSyncHandler({ env: f.env, publisher: { status: async () => ({ ok: true }), run: async () => { runs++; return { ok: true }; } }, authorizeAdmin: (req) => req.headers.cookie === 'synthetic-admin' });
  const invoke = async (req) => { const res = { statusCode: 200, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(body) { this.body = body; return this; } }; await handler({ method: 'GET', query: { action: 'run' }, headers: {}, ...req }, res); return res; };
  assert.equal((await invoke()).statusCode, 401);
  assert.equal((await invoke({ headers: { cookie: 'synthetic-admin' } })).statusCode, 403);
  assert.equal((await invoke({ headers: { authorization: `Bearer ${f.env.CRON_SECRET}` } })).statusCode, 200);
  assert.equal(runs, 1);
});
