import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaCatalog, META_CATALOG_FEED_URL, META_CATALOG_LATEST_FEED_URL } from '../lib/meta-catalog.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const CATALOG = '1817371622874450';
const FEED = '1117326544352704';
const BUSINESS = '759014320107772';
const TIME = Date.parse('2026-11-14T12:00:00Z');
const STATE = 'meta-catalog/v1/production/state.json';
const items = [
  { id: 'ID8Q11111', price: '26990.00 EUR', availability: 'in stock' },
  { id: 'ID8Q22222', price: '31990.00 EUR', availability: 'in stock' },
];
const asProduct = (item) => ({ id: item.id === items[0].id ? '111111111111' : '222222222222', retailer_id: item.id,
  availability: 'in stock', price: item.price, currency: 'EUR', review_status: '',
  capability_to_review_status: [{ key: 'WHATSAPP', value: 'APPROVED' }], visibility: 'published', product_feed: { id: FEED } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('different source and feed counts survive persistence and status reads', async () => {
  const f = fixture({ auditSource: async () => ({ valid: false, reason: 'source_feed_mismatch', sourceCount: 9, expectedCount: 7 }) });
  const report = await f.service.run();
  assert.equal(report.status, 'source_invalid');
  assert.equal(report.sourceCount, 9);
  assert.equal(report.expectedCount, 7);
  const saved = (await f.service.status()).lastResult;
  assert.equal(saved.sourceCount, 9);
  assert.equal(saved.expectedCount, 7);
  assert.equal(saved.catalogConfirmed, false);
  assert.equal(f.calls.length, 0);
});

test('an unreadable source never inherits the known feed count', async () => {
  const f = fixture({ auditSource: async () => ({ valid: false, reason: 'source_unavailable', expectedCount: 7 }) });
  assert.equal((await f.service.run()).sourceCount, null);
  const saved = (await f.service.status()).lastResult;
  assert.equal(saved.sourceCount, null);
  assert.equal(saved.expectedCount, 7);
});

test('source count survives successful audits and invalid item validation', async () => {
  for (const invalid of [false, true]) {
    const f = fixture({ auditSource: async () => ({ valid: true, sourceCount: 2, expectedCount: 2,
      items: items.map(item => ({ ...item, ...(invalid ? { id: 'invalid' } : {}) })) }) });
    const report = await f.service.run();
    assert.equal(report.status, invalid ? 'source_invalid' : 'catalog_matches');
    assert.equal(report.sourceCount, 2);
    assert.equal((await f.service.status()).lastResult.sourceCount, 2);
  }
});

test('legacy saved reports without a source count remain unknown', async () => {
  const f = fixture();
  await f.service.run();
  const record = f.blob.records.get(STATE);
  const state = JSON.parse(record.text);
  delete state.lastResult.sourceCount;
  record.text = JSON.stringify(state);
  const report = (await f.service.status()).lastResult;
  assert.equal(report.sourceCount, null);
  assert.equal(report.expectedCount, 2);
});

function fixture(options = {}) {
  const blob = options.blob || memoryBlob();
  const calls = [];
  const remote = { products: items.map(asProduct), uploads: [], granted: true, catalog: { id: CATALOG, name: 'AutoValorPT' }, feeds: [{ id: FEED, name: 'Samucar' }], feed: { id: FEED }, ...options.remote };
  const env = { VERCEL_ENV: 'production', META_CATALOG_ACCESS_TOKEN: 'synthetic-catalog-token', META_CATALOG_SYNC_ENABLED: 'true', ...options.env };
  let auditCalls = 0;
  const auditSource = options.auditSource || (async () => { auditCalls++; return { valid: true, expectedCount: items.length, items: structuredClone(items) }; });
  const fetchImpl = async (input, init) => {
    const url = new URL(input); calls.push({ url, init });
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(init.redirect, 'error');
    assert.equal(url.searchParams.has('access_token'), false);
    if (url.pathname.endsWith('/me/permissions')) return json({ data: [{ permission: 'catalog_management', status: remote.granted ? 'granted' : 'declined' }] });
    if (url.pathname === `/v27.0/${CATALOG}`) {
      // The real catalog_management-only credential cannot expand Business.
      if (/business/.test(url.searchParams.get('fields') || '')) return json({ error: { code: 100, message: 'Missing Permission' } }, 400);
      return json(remote.catalog);
    }
    if (url.pathname.endsWith('/product_feeds')) return json({ data: remote.feeds });
    if (url.pathname === `/v27.0/${FEED}`) {
      if (init.method === 'GET') return json(remote.feed);
      if (options.schedulePost) return options.schedulePost(url, init, remote);
      for (const [key, value] of new URLSearchParams(init.body)) {
        assert.ok(['schedule', 'update_schedule'].includes(key));
        remote.feed[key] = JSON.parse(value);
      }
      return json({ success: true });
    }
    if (url.pathname.endsWith('/products')) return options.productsResponse ? options.productsResponse(url, init) : json({ data: remote.products });
    if (url.pathname === `/v27.0/${FEED}/uploads` && init.method === 'GET') return json({ data: remote.uploads });
    if (url.pathname === `/v27.0/${FEED}/uploads` && init.method === 'POST') {
      assert.equal(JSON.parse(blob.records.get(STATE).text).active.phase, 'requesting', 'intent is durable before POST');
      const feedUrl = options.feedUrl || META_CATALOG_FEED_URL;
      assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { url: feedUrl, update_only: 'false' });
      if (options.post) return options.post(url, init, remote);
      remote.uploads.unshift({ id: '900000000001', start_time: new Date(TIME).toISOString(), url: feedUrl });
      return json({ id: '900000000001' });
    }
    throw new Error(`Unexpected synthetic request ${url.pathname}`);
  };
  const service = createMetaCatalog({ env, storage: blob.storage, fetchImpl, now: () => TIME, auditSource, ...(options.runtimeNow ? { runtimeNow: options.runtimeNow } : {}) });
  return { service, blob, calls, remote, env, auditCalls: () => auditCalls, posts: () => calls.filter((c) => c.init.method === 'POST') };
}

test('missing dedicated authorization does not reuse Facebook credentials or start Graph calls', async () => {
  const f = fixture({ env: { META_CATALOG_ACCESS_TOKEN: '', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-existing-token' } });
  const result = await f.service.run();
  assert.equal(result.status, 'authorization_required');
  assert.equal(result.permissionRequired, true);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.actualCount, null);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(JSON.parse(f.blob.records.get(STATE).text).lastValidSource.ids, items.map((item) => item.id));
  assert.ok([...f.blob.records.keys()].every((path) => path.startsWith('meta-catalog/')));
});

test('authorization probe reads only me/permissions even when catalog_management was already granted', async () => {
  const f = fixture({ env: { META_CATALOG_ACCESS_TOKEN: '', META_CATALOG_AUTHORIZATION_PROBE_ENABLED: 'true', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-existing-token' } });
  const result = await f.service.run();
  assert.equal(result.authorization.catalogManagementGranted, true);
  assert.equal(result.authorization.ready, false);
  assert.equal(result.reason, 'catalog_existing_token_not_enabled');
  assert.deepEqual(f.calls.map((c) => [c.url.pathname, c.init.method]), [['/v27.0/me/permissions', 'GET']]);
  assert.doesNotMatch(JSON.stringify(await f.service.status()), /synthetic-existing-token/);
});

test('explicit existing-token opt-in still requires granted catalog_management', async () => {
  const f = fixture({ env: { META_CATALOG_ACCESS_TOKEN: '', META_CATALOG_USE_EXISTING_FACEBOOK_TOKEN: 'true', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-existing-token' }, remote: { granted: false } });
  const result = await f.service.run();
  assert.equal(result.authorization.catalogManagementGranted, false);
  assert.equal(result.status, 'authorization_required');
  assert.equal(f.calls.length, 1);
});

test('explicit existing-token opt-in validates permission and the pinned catalog/feed binding', async () => {
  const f = fixture({ env: { META_CATALOG_ACCESS_TOKEN: '', META_CATALOG_USE_EXISTING_FACEBOOK_TOKEN: 'true', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-existing-token' } });
  const result = await f.service.check();
  assert.equal(f.calls[0].url.pathname, '/v27.0/me/permissions');
  assert.equal(result.authorization.source, 'existing_facebook');
  assert.equal(result.catalogValidated, true);
  assert.equal(result.status, 'catalog_matches');
  assert.equal(result.catalogConfirmed, true);
});

test('least-privilege catalog access confirms WhatsApp approval despite an empty legacy status', async () => {
  const f = fixture();
  f.remote.products[0].price = '€26,990.00';
  f.remote.products[1].price = '31.990,00 €';
  const result = await f.service.run();
  assert.equal(result.status, 'catalog_matches');
  assert.equal(result.actualCount, 2);
  assert.equal(result.whatsappVisibilityVerified, false);
  assert.equal(result.catalogConfirmed, true);
  assert.equal(f.calls.find((c) => c.url.pathname === `/v27.0/${CATALOG}`).url.searchParams.get('fields'), 'id,name');
  const productFields = f.calls.find((c) => c.url.pathname.endsWith('/products')).url.searchParams.get('fields').split(',');
  assert.ok(productFields.includes('capability_to_review_status'));
  assert.ok(!productFields.includes('review_status'));
  assert.equal(f.posts().length, 0);
  assert.equal((await f.service.status()).lastResult.status, 'catalog_matches');
  assert.ok(f.blob.calls.filter((c) => c.method === 'put').every((c) => c.options.access === 'private'));
});

test('changing any approved destination ID fails before source or Graph reads', async () => {
  for (const name of ['META_CATALOG_ID', 'META_CATALOG_FEED_ID', 'META_CATALOG_BUSINESS_ID']) {
    const f = fixture({ env: { [name]: '999999999999' } });
    const result = await f.service.run();
    assert.equal(result.status, 'check_failed');
    assert.equal(result.reason, 'meta_catalog_configuration_invalid');
    assert.equal(result.catalogConfirmed, false);
    assert.equal((await f.service.status()).configuration.valid, false);
    assert.equal(f.auditCalls(), 0);
    assert.equal(f.calls.length, 0);
  }
});

test('wrong catalogue, optional owner contradiction or feed membership prevents product reads and imports', async () => {
  for (const remote of [
    { catalog: { id: '999999999999' } },
    { catalog: { id: CATALOG, business: { id: '999999999999' } } },
    { catalog: { id: CATALOG, owner_business: { id: '999999999999' } } },
    { catalog: { id: CATALOG, business: { id: BUSINESS }, owner_business: { id: '999999999999' } } },
    { catalog: { id: CATALOG, owner_business: null } },
    { feeds: [{ id: '999999999999' }] },
    { feeds: [{ id: FEED }, { id: FEED }] },
  ]) {
    const f = fixture({ remote });
    const result = await f.service.run();
    assert.equal(result.status, 'check_failed');
    assert.match(result.reason, /mismatch$/);
    assert.equal(result.catalogValidated, false);
    assert.ok(f.calls.every((c) => !c.url.pathname.endsWith('/products')));
    assert.equal(f.posts().length, 0);
  }
});

test('an optional matching owner field preserves the least-privilege result', async () => {
  for (const key of ['business', 'owner_business']) {
    const f = fixture({ remote: { catalog: { id: CATALOG, [key]: { id: BUSINESS } } } });
    assert.equal((await f.service.check()).catalogConfirmed, true);
  }
});

test('incomplete remote pagination blocks imports and never follows provider next URLs', async () => {
  const f = fixture({ productsResponse: () => json({ data: [asProduct(items[0])], paging: { next: 'https://evil.test/?access_token=do-not-follow' } }) });
  const result = await f.service.run();
  assert.equal(result.reason, 'meta_catalog_listing_incomplete');
  assert.equal(f.posts().length, 0);
  assert.ok(f.calls.every((c) => c.url.origin === 'https://graph.facebook.com'));
});

test('products pagination reconstructs a fixed Graph endpoint from cursors', async () => {
  const f = fixture({ productsResponse: (url) => url.searchParams.has('after') ? json({ data: [asProduct(items[1])] }) :
    json({ data: [asProduct(items[0])], paging: { next: 'https://untrusted.invalid/page?access_token=hidden', cursors: { after: 'next-page' } } }) });
  assert.equal((await f.service.run()).status, 'catalog_matches');
  assert.equal(f.calls.filter((c) => c.url.pathname.endsWith('/products')).length, 2);
  assert.equal(f.posts().length, 0);
});

test('unknown price units do not cause an automatic price correction', async () => {
  const f = fixture(); f.remote.products[0].price = '2699000';
  const result = await f.service.run();
  assert.equal(result.reason, 'product_price_unverified');
  assert.deepEqual(result.priceUnverifiedIds, [items[0].id]);
  assert.equal(f.posts().length, 0);
});

test('foreign-feed products are not removed and expected IDs bound to another feed require review', async () => {
  const f = fixture();
  f.remote.products.push({ ...asProduct(items[0]), retailer_id: 'ID8Q33333', product_feed: { id: '777777777777' } });
  const first = await f.service.run();
  assert.equal(first.status, 'catalog_matches');
  assert.deepEqual(first.extraIds, []);
  f.remote.products[0].product_feed = { id: '777777777777' };
  const second = await f.service.run();
  assert.equal(second.reason, 'product_feed_unverified');
  assert.deepEqual(second.foreignFeedIds, [items[0].id]);
  assert.equal(f.posts().length, 0);
});

test('review rejection is reported separately and does not trigger a reimport of matching data', async () => {
  const f = fixture(); f.remote.products[1].capability_to_review_status = [{ key: 'WHATSAPP', value: 'REJECTED' }, { key: 'SHOPS', value: 'APPROVED' }];
  const result = await f.service.run();
  assert.equal(result.status, 'products_rejected');
  assert.deepEqual(result.rejectedIds, [items[1].id]);
  assert.equal(result.whatsappVisibilityVerified, false);
  assert.equal(f.posts().length, 0);
});

test('only one explicit WhatsApp approval can confirm the product, regardless of legacy or other-channel approval', async () => {
  for (const statuses of [
    undefined, null, '', [], {}, { WHATSAPP: 'APPROVED' },
    [{ key: 'SHOPS', value: 'APPROVED' }],
    [{ key: 'WHATSAPP', value: '' }],
    [{ key: 'WHATSAPP', value: 'NO_REVIEW' }],
    [{ key: 'WHATSAPP', value: 'PENDING' }],
    [{ key: 'WHATSAPP', value: 'OUTDATED' }],
    [{ key: 'WHATSAPP', value: 'approved' }],
    [{ key: 'WHATSAPP', value: 'UNRECOGNISED' }],
    [{ key: 'WHATSAPP' }],
    [{ key: 'WHATSAPP', value: null }],
    [{ key: 'WHATSAPP', value: 'APPROVED' }, { key: 'WHATSAPP', value: 'APPROVED' }],
    [{ key: 'WHATSAPP', value: 'APPROVED' }, { key: 'WHATSAPP', value: 'REJECTED' }],
    [{ key: 'WHATSAPP', value: 'APPROVED' }, null],
  ]) {
    const f = fixture();
    f.remote.products[0].review_status = 'approved';
    f.remote.products[0].capability_to_review_status = statuses;
    const report = await f.service.run();
    assert.equal(report.status, 'products_pending', JSON.stringify(statuses));
    assert.equal(report.catalogConfirmed, false);
    assert.deepEqual(report.pendingReviewIds, [items[0].id]);
    assert.equal(f.posts().length, 0);
  }
});

test('other channels neither confer nor veto an explicit WhatsApp approval', async () => {
  const f = fixture();
  f.remote.products[0].capability_to_review_status.push({ key: 'SHOPS', value: 'REJECTED' });
  assert.equal((await f.service.check()).catalogConfirmed, true);
});

test('check reports missing entries without importing; pending uploads block run', async () => {
  const f = fixture({ remote: { products: [asProduct(items[0])] } });
  const first = await f.service.check();
  assert.equal(first.status, 'catalog_mismatch');
  assert.deepEqual(first.missingIds, [items[1].id]);
  f.remote.uploads.push({ id: '800000000001', start_time: new Date(TIME - 1000).toISOString() });
  assert.equal((await f.service.run()).status, 'import_pending');
  assert.equal(f.posts().length, 0);
});

test('valid mismatch claims intent before POST and a repeated run cannot upload twice', async () => {
  const f = fixture({ remote: { products: [asProduct(items[0])] } });
  const first = await f.service.run();
  assert.equal(first.status, 'import_requested');
  assert.equal(first.import.requestedId, '900000000001');
  assert.equal(f.auditCalls(), 2);
  assert.equal((await f.service.run()).status, 'import_pending');
  assert.equal(f.posts().length, 1);
});

test('source rejection and a source change just before import preserve the destination', async () => {
  const invalid = fixture({ auditSource: async () => ({ valid: false, reason: 'inventory_count_mismatch' }) });
  assert.equal((await invalid.service.run()).status, 'source_invalid');
  assert.equal(invalid.calls.length, 0);
  let audits = 0;
  const changed = fixture({ remote: { products: [] }, auditSource: async () => {
    audits++; return { valid: true, expectedCount: 2, items: items.map((item) => ({ ...item, price: audits > 1 ? '10000.00 EUR' : item.price })) };
  } });
  assert.equal((await changed.service.run()).status, 'source_changed');
  assert.equal(changed.posts().length, 0);
});

test('sync must be explicitly enabled and cannot mutate from a preview deployment', async () => {
  for (const env of [{ META_CATALOG_SYNC_ENABLED: 'false' }, { VERCEL_ENV: 'preview' }]) {
    const f = fixture({ env, remote: { products: [] } });
    const result = await f.service.run();
    assert.ok(['sync_disabled', 'production_required'].includes(result.status));
    assert.equal(f.posts().length, 0);
  }
});

test('concurrent runs claim the same state with ETag and produce at most one upload', async () => {
  const blob = memoryBlob();
  const first = fixture({ blob, remote: { products: [] } });
  const second = fixture({ blob, remote: first.remote });
  const results = await Promise.all([first.service.run(), second.service.run()]);
  assert.equal(first.posts().length + second.posts().length, 1);
  assert.ok(results.some((r) => r.status === 'busy'));
});

test('an unknown upload outcome survives retries without another POST', async () => {
  const f = fixture({ remote: { products: [] }, post: async () => { throw new Error('synthetic-secret-token must never leak'); } });
  const first = await f.service.run();
  assert.equal(first.status, 'import_unknown');
  assert.equal((await f.service.status()).active.phase, 'unknown');
  assert.equal((await f.service.run()).status, 'import_unknown');
  assert.equal(f.posts().length, 1);
  assert.doesNotMatch(JSON.stringify(await f.service.status()), /synthetic-secret-token/);
});

test('known upload completion reconciles state, without claiming WhatsApp visibility', async () => {
  const f = fixture({ remote: { products: [] } });
  await f.service.run();
  f.remote.uploads[0].end_time = new Date(TIME + 5000).toISOString();
  f.remote.uploads[0].error_count = 0;
  f.remote.uploads[0].num_invalid_items = 0;
  f.remote.products = items.map(asProduct);
  const result = await f.service.check();
  assert.equal(result.status, 'catalog_matches');
  assert.equal((await f.service.status()).active, null);
  assert.equal(result.whatsappVisibilityVerified, false);
  assert.equal(f.posts().length, 1);
});

test('a completed upload that still differs requires review instead of uploading the same snapshot again', async () => {
  const f = fixture({ remote: { products: [] } });
  await f.service.run();
  f.remote.uploads[0].end_time = new Date(TIME + 5000).toISOString();
  f.remote.uploads[0].error_count = 1;
  const result = await f.service.run();
  assert.equal(result.reason, 'completed_import_still_differs');
  assert.equal(f.posts().length, 1);
});

test('later unrelated uploads cannot clear an unknown request', async () => {
  const f = fixture({ remote: { products: [] }, post: async () => { throw new Error('request interrupted'); } });
  await f.service.run();
  f.remote.uploads.push({ id: '900000000099', start_time: new Date(TIME + 3_600_000).toISOString(), end_time: new Date(TIME + 3_605_000).toISOString(), url: META_CATALOG_FEED_URL });
  assert.equal((await f.service.run()).status, 'import_unknown');
  assert.equal(f.posts().length, 1);
});

test('provider error bodies and authentication headers are never exposed in results or stored reports', async () => {
  const f = fixture({ remote: { products: [] }, post: async () => json({ error: { code: 200, message: 'synthetic-catalog-token is denied at a secret URL' } }, 403) });
  const result = await f.service.run();
  assert.equal(result.status, 'import_rejected');
  assert.equal(result.metaCode, 200);
  assert.equal(result.metaStatus, 403);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-catalog-token|secret URL/);
  assert.doesNotMatch(f.blob.records.get(STATE).text, /synthetic-catalog-token|secret URL|Authorization/);
  assert.equal((await f.service.status()).active, null);
});

test('an empty injected source is rejected before any Graph request', async () => {
  const f = fixture({ auditSource: async () => ({ valid: true, expectedCount: 0, items: [] }) });
  assert.equal((await f.service.run()).status, 'source_invalid');
  assert.equal(f.calls.length, 0);
});

test('all nine feed fields participate in the last-moment source check', async () => {
  let audits = 0;
  const f = fixture({ remote: { products: [] }, auditSource: async () => {
    audits++;
    return { valid: true, expectedCount: 2, items: items.map((item) => ({ ...item, title: audits === 1 ? 'Original title' : 'Changed title' })) };
  } });
  assert.equal((await f.service.run()).status, 'source_changed');
  assert.equal(f.posts().length, 0);
});

test('a Meta hourly upload in the same time window does not identify an unknown POST', async () => {
  const f = fixture({ remote: { products: [] }, post: async () => { throw new Error('interrupted'); } });
  await f.service.run();
  f.remote.uploads.push({ id: '900000000009', start_time: new Date(TIME).toISOString(), end_time: new Date(TIME + 5000).toISOString(),
    error_count: 0, num_invalid_items: 0, url: META_CATALOG_FEED_URL });
  assert.equal((await f.service.run()).status, 'import_unknown');
  assert.equal((await f.service.status()).active.uploadId, null);
  assert.equal(f.posts().length, 1);
});

test('a confirmed matching snapshot can resolve an unknown desired outcome without attributing any upload', async () => {
  const f = fixture({ remote: { products: [] }, post: async () => { throw new Error('interrupted'); } });
  await f.service.run();
  f.remote.products = items.map(asProduct);
  const result = await f.service.run();
  assert.equal(result.status, 'catalog_matches');
  assert.equal(result.catalogConfirmed, true);
  assert.equal((await f.service.status()).active, null);
  const state = JSON.parse(f.blob.records.get(STATE).text);
  assert.equal(state.lastReconciliation.method, 'catalog_snapshot');
  assert.equal(state.lastCompletedUpload, undefined);
  assert.equal(f.posts().length, 1);
});

test('unknown product review status and incomplete upload counts cannot confirm success', async () => {
  const f = fixture(); delete f.remote.products[0].capability_to_review_status;
  const first = await f.service.run();
  assert.equal(first.status, 'products_pending');
  assert.equal(first.catalogConfirmed, false);
  f.remote.products = items.map(asProduct);
  f.remote.uploads.push({ id: '800000000009', start_time: new Date(TIME - 5000).toISOString(), end_time: new Date(TIME - 1000).toISOString() });
  const second = await f.service.run();
  assert.equal(second.reason, 'upload_completion_unverified');
  assert.equal(second.catalogConfirmed, false);
  assert.equal(f.posts().length, 0);
});

test('an old incomplete upload does not outweigh a newer completed upload', async () => {
  const f = fixture({ remote: { uploads: [
    { id: '800000000001', start_time: new Date(TIME - 86_400_000).toISOString() },
    { id: '800000000002', start_time: new Date(TIME - 10_000).toISOString(), end_time: new Date(TIME - 1000).toISOString(), error_count: 0, num_invalid_items: 0 },
  ] } });
  const result = await f.service.run();
  assert.equal(result.status, 'catalog_matches');
  assert.equal(result.catalogConfirmed, true);
  assert.equal(f.posts().length, 0);
});

test('insufficient budget before revalidation defers without a durable upload intent', async () => {
  let runtime = 0;
  const f = fixture({ runtimeNow: () => runtime, productsResponse: () => { runtime = 130_000; return json({ data: [] }); } });
  const result = await f.service.run();
  assert.equal(result.status, 'check_deferred');
  assert.equal(f.auditCalls(), 1);
  assert.equal((await f.service.status()).active, null);
  assert.equal(f.posts().length, 0);
});

test('at least thirty seconds remain before persisting an upload intent', async () => {
  let runtime = 0; let audits = 0;
  const f = fixture({ runtimeNow: () => runtime, remote: { products: [] }, auditSource: async () => {
    if (++audits === 2) runtime = 155_000;
    return { valid: true, expectedCount: 2, items };
  } });
  assert.equal((await f.service.run()).status, 'check_deferred');
  assert.equal((await f.service.status()).active, null);
  assert.equal(f.posts().length, 0);
});

test('pagination stops when the global runtime budget expires', async () => {
  let runtime = 0;
  const f = fixture({ runtimeNow: () => runtime, productsResponse: () => {
    runtime = 181_000; return json({ data: [asProduct(items[0])], paging: { next: 'https://ignored.invalid', cursors: { after: 'more' } } });
  } });
  const result = await f.service.run();
  assert.equal(result.status, 'check_deferred');
  assert.equal(f.calls.filter((c) => c.url.pathname.endsWith('/products')).length, 1);
  assert.equal(f.posts().length, 0);
});

const SNAPSHOT_HASH = 'a'.repeat(64);
const SNAPSHOT_URL = `https://autovalorpt-assistente.vercel.app/api/stock?integration=stock-feed&snapshot=${SNAPSHOT_HASH}`;
const snapshotAudit = (feedUrl = SNAPSHOT_URL) => ({ valid: true, sourceCount: items.length, expectedCount: items.length,
  items: structuredClone(items), feedHash: SNAPSHOT_HASH, feedUrl });

test('snapshot import uses the exact immutable URL while preserving the existing catalogue binding', async () => {
  const legacy = fixture();
  assert.equal((await legacy.service.check()).catalogConfirmed, true);
  const oldBinding = JSON.parse(legacy.blob.records.get(STATE).text).binding;
  const current = fixture({ blob: legacy.blob, remote: { products: [] }, feedUrl: SNAPSHOT_URL,
    auditSource: async () => snapshotAudit() });
  assert.equal((await current.service.run()).status, 'import_requested');
  const state = JSON.parse(current.blob.records.get(STATE).text);
  assert.equal(state.binding, oldBinding);
  assert.equal(state.active.feedUrl, SNAPSHOT_URL);
  assert.equal(state.active.fingerprint, SNAPSHOT_HASH);
  assert.equal(state.lastValidSource.feedUrl, SNAPSHOT_URL);
  assert.equal(current.posts().length, 1);
  current.remote.uploads[0] = { ...current.remote.uploads[0], end_time: new Date(TIME + 5000).toISOString(), error_count: 0, num_invalid_items: 0 };
  current.remote.products = items.map(asProduct);
  assert.equal((await current.service.check()).catalogConfirmed, true);
  assert.equal((await current.service.status()).active, null);
  assert.equal(current.posts().length, 1);
});

test('forged, mutable or mismatched snapshot URLs fail before Graph or an import intent', async () => {
  for (const feedUrl of [null, '', SNAPSHOT_URL.replace('https:', 'http:'),
    SNAPSHOT_URL.replace('.vercel.app', '.evil.test'), `${SNAPSHOT_URL}&extra=1`, `${SNAPSHOT_URL}#fragment`,
    SNAPSHOT_URL.replace(SNAPSHOT_HASH, 'b'.repeat(64)), SNAPSHOT_URL.replace(SNAPSHOT_HASH, 'A'.repeat(64)),
    SNAPSHOT_URL.replace('?integration=stock-feed&snapshot=', '?snapshot=')]) {
    const f = fixture({ remote: { products: [] }, auditSource: async () => snapshotAudit(feedUrl) });
    const result = await f.service.run();
    assert.equal(result.status, 'source_invalid', String(feedUrl));
    assert.equal(result.reason, 'source_feed_url_invalid');
    assert.equal(f.calls.length, 0);
    assert.equal((await f.service.status()).active, null);
  }
});

test('transport changes during revalidation prevent an import even with the same fingerprint', async () => {
  let audits = 0;
  const f = fixture({ remote: { products: [] }, auditSource: async () => snapshotAudit(++audits === 1 ? META_CATALOG_FEED_URL : SNAPSHOT_URL) });
  assert.equal((await f.service.run()).status, 'source_changed');
  assert.equal(f.posts().length, 0);
  assert.equal((await f.service.status()).active, null);
});

test('an unrelated URL cannot reconcile a known snapshot import even if the upload ID matches', async () => {
  for (const wrongUrl of [undefined, META_CATALOG_FEED_URL, SNAPSHOT_URL.replace(SNAPSHOT_HASH, 'b'.repeat(64)), 'https://evil.test/feed.csv']) {
    const f = fixture({ remote: { products: [] }, feedUrl: SNAPSHOT_URL, auditSource: async () => snapshotAudit() });
    await f.service.run();
    f.remote.uploads[0] = { ...f.remote.uploads[0], url: wrongUrl, end_time: new Date(TIME + 5000).toISOString(), error_count: 0, num_invalid_items: 0 };
    f.remote.products = items.map(asProduct);
    assert.equal((await f.service.run()).status, 'import_pending', String(wrongUrl));
    assert.equal((await f.service.status()).active.uploadId, '900000000001');
    assert.equal(f.posts().length, 1);
  }
});

test('an old Google import reconciles by its original URL after switching source providers', async () => {
  const legacy = fixture({ remote: { products: [] } });
  await legacy.service.run();
  const stored = legacy.blob.records.get(STATE);
  const state = JSON.parse(stored.text);
  delete state.active.feedUrl; // Version-1 records created before transport support.
  stored.text = JSON.stringify(state);
  legacy.remote.uploads[0] = { ...legacy.remote.uploads[0], end_time: new Date(TIME + 5000).toISOString(), error_count: 0, num_invalid_items: 0 };
  legacy.remote.products = items.map(asProduct);
  const current = fixture({ blob: legacy.blob, remote: legacy.remote, feedUrl: SNAPSHOT_URL,
    auditSource: async () => snapshotAudit() });
  const report = await current.service.check();
  assert.equal(report.catalogConfirmed, true);
  assert.equal((await current.service.status()).active, null);
  assert.equal(JSON.parse(stored.text).binding, state.binding);
  assert.equal(current.posts().length, 0);
});

test('unknown legacy imports stay blocked when a different snapshot becomes current', async () => {
  const legacy = fixture({ remote: { products: [] }, post: async () => { throw new Error('interrupted'); } });
  await legacy.service.run();
  const current = fixture({ blob: legacy.blob, remote: { products: items.map(asProduct) }, feedUrl: SNAPSHOT_URL,
    auditSource: async () => snapshotAudit() });
  assert.equal((await current.service.run()).status, 'import_unknown');
  assert.equal((await current.service.status()).active.phase, 'unknown');
  assert.equal(current.posts().length, 0);
});

test('production run migrates both known Google schedules and preserves their cadence', async () => {
  const schedule = { id: '123456789', interval: 'HOURLY', interval_count: 1, minute: 15,
    timezone: 'Europe/Lisbon', url: META_CATALOG_FEED_URL };
  const update = { interval: 'DAILY', hour: 8, minute: 0, url: META_CATALOG_FEED_URL };
  const f = fixture({ remote: { feed: { id: FEED, schedule, update_schedule: update } },
    auditSource: async () => snapshotAudit() });
  const report = await f.service.run();
  assert.equal(report.catalogConfirmed, true);
  assert.equal(report.feedScheduleVerified, true);
  assert.equal(f.posts().length, 1);
  assert.equal(f.posts()[0].url.pathname, `/v27.0/${FEED}`);
  const payload = Object.fromEntries(new URLSearchParams(f.posts()[0].init.body));
  assert.deepEqual(JSON.parse(payload.schedule), { interval: 'HOURLY', interval_count: 1, minute: 15,
    timezone: 'Europe/Lisbon', url: META_CATALOG_LATEST_FEED_URL });
  assert.deepEqual(JSON.parse(payload.update_schedule), { ...update, url: META_CATALOG_LATEST_FEED_URL });
  assert.equal(f.calls.filter(call => call.url.pathname === `/v27.0/${FEED}` && call.init.method === 'GET').length, 2);
  assert.equal((await f.service.run()).feedScheduleVerified, true);
  assert.equal(f.posts().length, 1, 'readback prevents an unnecessary repeated migration');
});

test('already migrated and absent schedules require no write', async () => {
  for (const feed of [{ id: FEED }, { id: FEED, schedule: null, update_schedule: {} },
    { id: FEED, schedule: { interval: 'HOURLY', url: META_CATALOG_LATEST_FEED_URL } }]) {
    const f = fixture({ remote: { feed }, auditSource: async () => snapshotAudit() });
    assert.equal((await f.service.run()).feedScheduleVerified, true);
    assert.equal(f.posts().length, 0);
  }
});

test('foreign or malformed schedules fail closed before any import or schedule update', async () => {
  for (const schedule of [
    { interval: 'HOURLY', url: 'https://foreign.example/feed.csv' },
    { interval: 'HOURLY', url: META_CATALOG_FEED_URL, username: 'private-user' },
    { interval: 'HOURLY', url: META_CATALOG_FEED_URL, password: 'not-to-send' },
    { interval: 'HOURLY', url: META_CATALOG_FEED_URL, minute: 90 },
    { interval: 'UNRECOGNIZED', url: META_CATALOG_FEED_URL },
  ]) {
    const f = fixture({ remote: { products: [], feed: { id: FEED, schedule } }, auditSource: async () => snapshotAudit() });
    const report = await f.service.run();
    assert.equal(report.status, 'check_failed'); assert.equal(report.reason, 'meta_catalog_schedule_invalid');
    assert.equal(f.posts().length, 0); assert.equal((await f.service.status()).active, null);
    assert.doesNotMatch(f.blob.records.get(STATE).text, /not-to-send|private-user|foreign.example/);
  }
});

test('check and non-production or disabled runs cannot change an existing schedule', async () => {
  for (const variant of [{ check: true }, { env: { VERCEL_ENV: 'preview' } }, { env: { META_CATALOG_SYNC_ENABLED: 'false' } }]) {
    const f = fixture({ env: variant.env, remote: { feed: { id: FEED, schedule: { interval: 'HOURLY', url: META_CATALOG_FEED_URL } } },
      auditSource: async () => snapshotAudit() });
    await (variant.check ? f.service.check() : f.service.run());
    assert.equal(f.posts().length, 0);
    assert.equal(f.remote.feed.schedule.url, META_CATALOG_FEED_URL);
  }
});

test('a failed schedule readback blocks catalogue import and does not retry the write within the run', async () => {
  const f = fixture({ remote: { products: [], feed: { id: FEED, schedule: { interval: 'HOURLY', url: META_CATALOG_FEED_URL } } },
    auditSource: async () => snapshotAudit(), schedulePost: () => json({ success: true }) });
  const report = await f.service.run();
  assert.equal(report.reason, 'meta_catalog_schedule_unconfirmed');
  assert.deepEqual(report.feedScheduleCheck, { mismatches: ['schedule.url'], sources: { schedule: 'legacy', update_schedule: 'absent' } });
  assert.deepEqual((await f.service.status()).lastResult.feedScheduleCheck, report.feedScheduleCheck);
  assert.equal(f.posts().length, 1);
  assert.equal(f.posts()[0].url.pathname, `/v27.0/${FEED}`);
  assert.equal((await f.service.status()).active, null);
});

test('schedule readback reports only field names and source classes when cadence or presence changes', async () => {
  const f = fixture({ remote: { products: [], feed: { id: FEED,
    schedule: { interval: 'DAILY', hour: 8, minute: 15, timezone: 'Europe/Lisbon', url: META_CATALOG_FEED_URL } } },
    auditSource: async () => snapshotAudit(), schedulePost: (_url, init, remote) => {
      remote.feed.schedule = { ...JSON.parse(new URLSearchParams(init.body).get('schedule')), hour: 9, minute: 30 };
      remote.feed.update_schedule = { interval: 'HOURLY', url: META_CATALOG_LATEST_FEED_URL };
      return json({ success: true });
    } });
  const report = await f.service.run();
  assert.equal(report.reason, 'meta_catalog_schedule_unconfirmed');
  assert.deepEqual(report.feedScheduleCheck, { mismatches: ['schedule.hour', 'schedule.minute', 'update_schedule.presence'],
    sources: { schedule: 'server', update_schedule: 'server' } });
  assert.equal(report.catalogConfirmed, false);
  assert.equal(f.posts().length, 1);
  assert.doesNotMatch(JSON.stringify(report.feedScheduleCheck), /https:|Europe|synthetic/);
});

test('schedule readback identity mismatch is diagnosed without returning the unexpected identifier', async () => {
  const f = fixture({ remote: { products: [], feed: { id: FEED, schedule: { interval: 'HOURLY', url: META_CATALOG_FEED_URL } } },
    auditSource: async () => snapshotAudit(), schedulePost: (_url, _init, remote) => {
      remote.feed.id = 'untrusted-private-identifier';
      return json({ success: true });
    } });
  const report = await f.service.run();
  assert.equal(report.reason, 'meta_catalog_schedule_unconfirmed');
  assert.deepEqual(report.feedScheduleCheck.mismatches, ['feed.id']);
  assert.doesNotMatch(JSON.stringify(report), /untrusted-private-identifier/);
  assert.equal(f.posts().length, 1);
});

test('persisted schedule diagnosis strips unrecognized fields and values', async () => {
  const f = fixture();
  await f.service.run();
  const record = f.blob.records.get(STATE); const state = JSON.parse(record.text);
  state.lastResult.feedScheduleCheck = { mismatches: ['schedule.url', 'schedule.password', 'sensitive-value', 'schedule.url'],
    sources: { schedule: 'server', update_schedule: 'https://secret.example/?token=secret', password: 'secret' }, raw: 'secret' };
  record.text = JSON.stringify(state);
  const report = (await f.service.status()).lastResult;
  assert.deepEqual(report.feedScheduleCheck, { mismatches: ['schedule.url'], sources: { schedule: 'server' } });
  assert.doesNotMatch(JSON.stringify(report), /secret|sensitive|password/);
});

test('latest-snapshot passive uploads can confirm catalogue but cannot reconcile an immutable active import', async () => {
  const f = fixture({ remote: { products: [] }, feedUrl: SNAPSHOT_URL, auditSource: async () => snapshotAudit() });
  await f.service.run();
  f.remote.uploads[0] = { ...f.remote.uploads[0], url: META_CATALOG_LATEST_FEED_URL,
    end_time: new Date(TIME + 1000).toISOString(), error_count: 0, num_invalid_items: 0 };
  f.remote.products = items.map(asProduct);
  assert.equal((await f.service.run()).status, 'import_pending');
  assert.equal(f.posts().length, 1);
  const passive = fixture({ remote: { uploads: f.remote.uploads }, auditSource: async () => snapshotAudit() });
  assert.equal((await passive.service.check()).catalogConfirmed, true);
  assert.equal(passive.posts().length, 0);
});

