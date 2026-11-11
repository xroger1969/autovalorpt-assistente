import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInstagramStories, storyFingerprint } from '../lib/instagram-stories.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const ledgerPath = 'instagram/v1/production/stories.json';
const publicationPath = 'instagram/v1/production/state.json';
const fields = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const car = (id = 'ID8live01', extra = {}) => ({ id, title: 'Tesla Model Y Long Range', description: '2023 | 42 000 km | Elétrico', availability: 'in stock', condition: 'used', price: '34990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/tesla-${id}.html`, image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;q=100;s=600x0`, brand: 'Tesla', ...extra });
const csv = rows => [fields, ...rows.map(item => fields.map(key => item[key]))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
const permissions = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_contents', 'pages_read_engagement'];

function fixture(options = {}) {
  const memory = memoryBlob(); const calls = []; const renders = [];
  let clock = Date.parse('2026-11-11T12:00:00Z');
  const env = { VERCEL_ENV: 'production', INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_LOGIN_MODE: 'instagram',
    INSTAGRAM_STORIES_ENABLED: 'true', INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic/export?format=csv&gid=0',
    INSTAGRAM_RETIREMENTS_USER_ID: '17841499990000000', INSTAGRAM_RETIREMENTS_PAGE_ID: '99111100000000',
    INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-story-token', INSTAGRAM_RETIREMENTS_GRAPH_VERSION: 'v27.0',
    INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt.example', ADMIN_SESSION_SECRET: 'synthetic-video-signing-secret-32-chars', ...options.env };
  let items = options.items || [car(), car('ID8old001')]; let rawFeed;
  let granted = [...permissions]; let accountType = 'BUSINESS'; let username = 'autovalorpt'; let linkedId = env.INSTAGRAM_RETIREMENTS_USER_ID;
  let profileId = env.INSTAGRAM_USER_ID; const instagramToken = 'synthetic-instagram-profile-token';
  let publishResult = 'success'; let deleteResult = 'success'; let containerStatus = 'FINISHED';
  let renderHook, publishHook, containerReadHook, permissionHook, ledgerWriteHook;
  let nextContainer = 880000000; let nextMedia = 990000000;
  const publication = { version: 1, accountId: env.INSTAGRAM_USER_ID, username: 'autovalorpt', loginMode: env.INSTAGRAM_LOGIN_MODE,
    sourceHash: createHash('sha256').update(env.INSTAGRAM_FEED_URL).digest('hex'), lastFeedCount: options.lastFeedCount || items.length,
    items: Object.fromEntries(items.map((item, index) => [item.id, { status: 'published', mediaId: String(770000001 + index), updatedAt: new Date(clock - 3600_000).toISOString() }])),
    lastResult: { status: 'published', id: 'ID8live01', at: new Date(clock - 3600_000).toISOString() } };
  memory.records.set(publicationPath, { text: JSON.stringify(publication), etag: 'publication-seed' });
  const baseHead = memory.storage.head; const basePut = memory.storage.put;
  memory.storage.head = async (path, options) => {
    const entry = memory.records.get(path);
    if (!entry) throw Object.assign(new Error('Mock blob not found'), { name: 'BlobNotFoundError', status: 404 });
    const result = await baseHead(path, options);
    return { ...result, size: Buffer.byteLength(entry.text), contentType: path.endsWith('.mp4') ? 'video/mp4' : 'application/json' };
  };
  memory.storage.put = async (path, body, options) => {
    if (path === ledgerPath) await ledgerWriteHook?.(JSON.parse(body));
    if (!Buffer.isBuffer(body)) return basePut(path, body, options);
    memory.calls.push({ method: 'put', path, options });
    if (memory.records.has(path)) throw Object.assign(new Error('Precondition failed'), { name: 'BlobPreconditionFailedError', status: 412 });
    const etag = `video-${memory.records.size}`; memory.records.set(path, { text: body, etag }); return { pathname: path, etag };
  };
  const fetchImpl = async (address, settings = {}) => {
    const url = new URL(address); const method = settings.method || 'GET';
    calls.push({ url: url.href, method, body: settings.body });
    if (url.hostname === 'docs.google.com') return new Response(rawFeed ?? csv(items), { headers: { 'content-type': 'text/csv' } });
    if (url.hostname === 'graph.instagram.com') {
      assert.equal(method, 'GET'); assert.equal(url.pathname, `/${env.INSTAGRAM_GRAPH_VERSION || 'v26.0'}/me`);
      assert.equal(url.searchParams.get('fields'), 'user_id,username,account_type');
      assert.equal(url.searchParams.has('access_token'), false); assert.equal(settings.headers.Authorization, `Bearer ${instagramToken}`);
      return Response.json({ user_id: profileId, username, account_type: accountType });
    }
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(settings.headers.Authorization, `Bearer ${env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN}`);
    assert.equal(url.searchParams.has('access_token'), false);
    if (url.pathname.endsWith('/me/permissions')) { await permissionHook?.(); return Response.json({ data: granted.map(permission => ({ permission, status: 'granted' })) }); }
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_PAGE_ID}`)) return Response.json({ id: env.INSTAGRAM_RETIREMENTS_PAGE_ID, instagram_business_account: { id: linkedId, username } });
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_USER_ID}`)) {
      assert.equal(url.searchParams.get('fields'), 'id,username');
      return Response.json({ id: env.INSTAGRAM_RETIREMENTS_USER_ID, username });
    }
    if (method === 'POST' && url.pathname.endsWith('/media')) {
      const body = new URLSearchParams(settings.body); assert.equal(body.get('media_type'), 'STORIES');
      const video = new URL(body.get('video_url')); assert.equal(video.hostname, 'autovalorpt.example');
      assert.equal(video.searchParams.get('integration'), 'instagram-video'); assert.equal(video.searchParams.has('access_token'), false);
      assert.ok(memory.records.get(ledgerPath), 'Durable claim precedes container creation');
      return Response.json({ id: String(++nextContainer) });
    }
    if (method === 'POST' && url.pathname.endsWith('/media_publish')) {
      const intent = JSON.parse(memory.records.get(ledgerPath).text);
      assert.equal(intent.active.phase, 'publishing', 'Durable claim precedes actual publication');
      await publishHook?.();
      if (publishResult === 'transport') throw new Error('Private transport diagnostic');
      if (publishResult === 'invalid') return Response.json({ success: true });
      if (publishResult === 'rejected') return Response.json({ error: { code: 10, message: 'Private provider diagnostic' } }, { status: 403 });
      return Response.json({ id: String(++nextMedia) });
    }
    if (method === 'DELETE') {
      const id = url.pathname.split('/').at(-1); const intent = JSON.parse(memory.records.get(ledgerPath).text);
      assert.equal(intent.active.phase, 'deleting'); assert.equal(intent.active.mediaId, id);
      if (deleteResult === 'transport') throw new Error('Delete transport interrupted');
      return Response.json({ success: true, deleted_id: deleteResult === 'wrong-id' ? '99999999999' : id });
    }
    if (url.searchParams.get('fields') === 'status_code') { await containerReadHook?.(); return Response.json({ status_code: containerStatus }); }
    throw new Error(`Unexpected test request ${method} ${url.pathname}`);
  };
  const renderVideo = async (item, settings) => {
    renders.push({ ...item }); assert.ok(settings.deadline > Date.now()); await renderHook?.(item);
    return { buffer: Buffer.alloc(2048, 1), mimeType: 'video/mp4', duration: 30, width: 1080, height: 1920 };
  };
  const stories = createInstagramStories({ env, storage: memory.storage, fetchImpl, now: () => clock, renderVideo, tokenManager: { resolve: async () => instagramToken }, pause: async () => {}, pollAttempts: 0 });
  return { env, memory, calls, renders, stories, publication, getItems: () => items,
    ledger: () => JSON.parse(memory.records.get(ledgerPath).text),
    posts: () => calls.filter(call => call.method === 'POST' && call.url.includes('/media_publish')),
    containers: () => calls.filter(call => call.method === 'POST' && call.url.endsWith('/media')),
    deletes: () => calls.filter(call => call.method === 'DELETE'),
    setItems: value => { items = value; }, setRawFeed: value => { rawFeed = value; },
    setPermissions: value => { granted = value; }, setAccountType: value => { accountType = value; },
    setUsername: value => { username = value; }, setLinkedId: value => { linkedId = value; }, setProfileId: value => { profileId = value; },
    setPublishResult: value => { publishResult = value; }, setDeleteResult: value => { deleteResult = value; }, setContainerStatus: value => { containerStatus = value; },
    setRenderHook: value => { renderHook = value; }, setPublishHook: value => { publishHook = value; },
    setContainerReadHook: value => { containerReadHook = value; }, setPermissionHook: value => { permissionHook = value; },
    setLedgerWriteHook: value => { ledgerWriteHook = value; },
    advance: milliseconds => { clock += milliseconds; },
    rewriteLedger: change => { const current = memory.records.get(ledgerPath); const value = JSON.parse(current.text); change(value); current.text = JSON.stringify(value); },
  };
}

test('Stories default disabled never reads feed, storage or Meta', async () => {
  const f = fixture({ env: { INSTAGRAM_STORIES_ENABLED: undefined } });
  assert.deepEqual(await f.stories.run(), { ok: true, status: 'disabled', published: 0 });
  assert.equal(f.calls.length, 0); assert.equal(f.memory.calls.length, 0); assert.equal(f.renders.length, 0);
});

test('first automatic execution baselines stock without backfilling old vehicles', async () => {
  const f = fixture(); assert.equal((await f.stories.run()).status, 'baseline_initialized');
  assert.equal((await f.stories.run()).status, 'no_new_stock');
  assert.equal(f.renders.length, 0); assert.equal(f.posts().length, 0);
  assert.deepEqual(Object.values(f.ledger().items).map(item => item.status), ['baseline', 'baseline']);
});

test('new IDs are queued and one newest available vehicle is published each run', async () => {
  const f = fixture(); await f.stories.run();
  f.setItems([...f.getItems(), car('ID8new001'), car('ID8new002'), car('ID8sold01', { availability: 'out of stock' })]);
  assert.equal((await f.stories.run()).id, 'ID8new002');
  assert.equal(f.ledger().items.ID8new001.status, 'queued'); assert.equal(f.ledger().items.ID8sold01.status, 'canceled');
  assert.equal((await f.stories.run()).id, 'ID8new001');
  assert.equal((await f.stories.run()).status, 'no_new_stock');
  assert.equal(f.posts().length, 2); assert.deepEqual(f.renders.map(item => item.id), ['ID8new002', 'ID8new001']);
});

test('explicit first sample requires latest confirmed photo publication and is not repeated', async () => {
  const f = fixture(); const originalPublication = f.memory.records.get(publicationPath).text;
  assert.equal((await f.stories.run({ sampleId: 'ID8live01' })).status, 'published');
  assert.equal((await f.stories.run({ sampleId: 'ID8live01' })).status, 'already_processed');
  assert.equal(f.posts().length, 1); assert.equal(f.memory.records.get(publicationPath).text, originalPublication);
  for (const sampleId of ['ID8old001', 'ID8absent', '../other']) await assert.rejects(f.stories.run({ sampleId }));
  f.advance(49 * 3600_000); await assert.rejects(f.stories.run({ sampleId: 'ID8live01' }), { code: 'story_test_requires_latest_publication' });
});

test('private preview persists video but never publishes or queries Meta', async () => {
  const f = fixture({ env: { INSTAGRAM_STORIES_ENABLED: undefined } });
  const result = await f.stories.preview('ID8live01');
  assert.equal(result.status, 'preview_ready'); assert.equal(result.published, 0); assert.match(result.videoUrl, /signature=/);
  assert.equal(f.posts().length, 0); assert.equal(f.calls.filter(call => call.url.includes('graph.facebook.com')).length, 0);
  assert.equal(f.ledger().items.ID8live01.status, 'preview_ready');
});

test('failed or interrupted private previews never automatically publish baseline stock', async () => {
  for (const interrupted of [false, true]) {
    const f = fixture(); f.setRenderHook(() => { throw new Error('Preview renderer interrupted'); });
    if (interrupted) f.setLedgerWriteHook(state => { if (state.lastResult?.status === 'preview_failed') throw new Error('Preview cleanup interrupted'); });
    await assert.rejects(f.stories.preview('ID8live01'));
    if (interrupted) { assert.equal(f.ledger().active.mode, 'preview'); assert.equal(f.ledger().active.phase, 'rendering'); }
    else assert.equal(f.ledger().items.ID8live01.status, 'preview_failed');
    f.setRenderHook(undefined); f.setLedgerWriteHook(undefined); f.advance(7 * 60_000);
    assert.equal((await f.stories.run()).status, 'no_new_stock');
    assert.equal(f.ledger().active, null); assert.equal(f.ledger().items.ID8live01.status, 'preview_failed');
    assert.equal(f.posts().length, 0); assert.equal(f.containers().length, 0); assert.equal(f.renders.length, 1);
    assert.equal((await f.stories.run({ sampleId: 'ID8live01' })).status, 'published'); assert.equal(f.posts().length, 1);
  }
});

test('dry run checks account and permissions without writing media or state', async () => {
  const f = fixture(); f.setAccountType('business'); const before = [...f.memory.records.entries()]; const result = await f.stories.dryRun();
  assert.equal(result.authorization.ready, true); assert.equal(result.wouldInitializeBaseline, true);
  assert.deepEqual([...f.memory.records.entries()], before); assert.equal(f.renders.length, 0); assert.equal(f.posts().length, 0);
});

test('each required permission is enforced before render or publish', async () => {
  for (const omitted of permissions) {
    const f = fixture(); f.setPermissions(permissions.filter(permission => permission !== omitted));
    const result = await f.stories.run({ sampleId: 'ID8live01' });
    assert.equal(result.status, 'authorization_required'); assert.deepEqual(result.authorization.missingPermissions, [omitted]);
    assert.equal(f.renders.length, 0); assert.equal(f.posts().length, 0); assert.equal(f.memory.records.has(ledgerPath), false);
  }
});

test('creator or unknown account type cannot publish a Story', async () => {
  for (const type of ['MEDIA_CREATOR', 'PERSONAL', undefined]) {
    const f = fixture(); f.setAccountType(type); const result = await f.stories.run({ sampleId: 'ID8live01' });
    assert.equal(result.status, 'authorization_required'); assert.equal(result.authorization.reason, 'instagram_business_account_required');
    assert.equal(f.posts().length, 0); assert.equal(f.renders.length, 0);
  }
});

test('wrong account or Page association fails closed', async () => {
  for (const alter of [f => f.setUsername('unrelated_account'), f => f.setLinkedId('17841488880000000'), f => f.setProfileId('17841488880000000')]) {
    const f = fixture(); alter(f); await assert.rejects(f.stories.run({ sampleId: 'ID8live01' }), { code: 'wrong_story_account' });
    assert.equal(f.posts().length, 0); assert.equal(f.renders.length, 0);
  }
});

test('nonproduction, invalid feed and unsupported Graph version cannot publish', async () => {
  for (const [env, expected] of [[{ VERCEL_ENV: 'preview' }, 'production_required'], [{ INSTAGRAM_FEED_URL: 'https://untrusted.example/feed.csv' }, 'feed_not_configured']]) {
    const f = fixture({ env });
    await assert.rejects(f.stories.run({ sampleId: 'ID8live01' }), { code: expected });
    assert.equal(f.posts().length, 0); assert.equal(f.renders.length, 0);
  }
  const outdated = fixture({ env: { INSTAGRAM_RETIREMENTS_GRAPH_VERSION: 'v26.0' } });
  assert.equal((await outdated.stories.run({ sampleId: 'ID8live01' })).status, 'authorization_required');
  assert.equal(outdated.posts().length, 0); assert.equal(outdated.renders.length, 0);
});

test('malformed, duplicate and suspiciously shrunken feeds never publish', async () => {
  const broken = fixture(); broken.setRawFeed(csv([car()]) + '\n"unfinished');
  const duplicate = fixture(); duplicate.setRawFeed(csv([car(), car()]));
  const partial = fixture({ lastFeedCount: 10 });
  const mismatched = fixture({ items: [car('ID8live01', { link: car('ID8wrong1').link }), car('ID8old001')] });
  for (const f of [broken, duplicate, partial, mismatched]) {
    await assert.rejects(f.stories.run({ sampleId: 'ID8live01' })); assert.equal(f.posts().length, 0); assert.equal(f.renders.length, 0);
  }
});

test('withdrawal or price change during rendering cancels before container creation', async () => {
  for (const change of [{ availability: 'out of stock' }, { price: '33990.00 EUR' }]) {
    const f = fixture(); f.setRenderHook(() => f.setItems([car('ID8live01', change), car('ID8old001')]));
    const result = await f.stories.run({ sampleId: 'ID8live01' });
    assert.equal(result.status, 'canceled'); assert.equal(result.reason, 'stock_changed_during_render');
    assert.equal(f.containers().length, 0); assert.equal(f.posts().length, 0);
  }
});

test('withdrawal after Meta preparation prevents final publication', async () => {
  const f = fixture(); f.setContainerReadHook(() => f.setItems([car('ID8live01', { availability: 'out of stock' }), car('ID8old001')]));
  const result = await f.stories.run({ sampleId: 'ID8live01' });
  assert.equal(result.status, 'canceled'); assert.equal(result.reason, 'stock_changed_before_publication');
  assert.equal(f.containers().length, 1); assert.equal(f.posts().length, 0);
});

test('changed price after preview regenerates the video before publishing', async () => {
  const f = fixture(); await f.stories.preview('ID8live01');
  f.setItems([car('ID8live01', { price: '33990.00 EUR' }), car('ID8old001')]);
  assert.equal((await f.stories.run({ sampleId: 'ID8live01' })).status, 'published');
  assert.deepEqual(f.renders.map(item => item.price), ['34990.00 EUR', '33990.00 EUR']);
  assert.equal(f.ledger().items.ID8live01.fingerprint, storyFingerprint(f.getItems()[0]));
});

test('an overlapping publisher cannot publish while another holds the durable intent', async () => {
  const f = fixture(); let unblock; let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const hold = new Promise(resolve => { unblock = resolve; });
  f.setPublishHook(async () => { reached(); await hold; });
  const first = f.stories.run({ sampleId: 'ID8live01' }); await entered;
  assert.equal((await f.stories.run({ sampleId: 'ID8live01' })).status, 'review_required');
  unblock(); assert.equal((await first).status, 'published'); assert.equal(f.posts().length, 1);
  const race = fixture(); const results = await Promise.all([race.stories.run({ sampleId: 'ID8live01' }), race.stories.run({ sampleId: 'ID8live01' })]);
  assert.deepEqual(results.map(result => result.status).sort(), ['busy', 'published']); assert.equal(race.posts().length, 1);
});

test('resumed containers keep a single publish claim and missing stock releases the queue safely', async () => {
  const race = fixture(); race.setContainerStatus('IN_PROGRESS');
  assert.equal((await race.stories.run({ sampleId: 'ID8live01' })).status, 'preparing');
  race.advance(7 * 60_000); race.setContainerStatus('FINISHED');
  const results = await Promise.all([race.stories.run(), race.stories.run()]);
  assert.deepEqual(results.map(result => result.status).sort(), ['busy', 'published']);
  assert.equal(race.containers().length, 1); assert.equal(race.posts().length, 1);

  const missing = fixture(); missing.setContainerStatus('IN_PROGRESS');
  assert.equal((await missing.stories.run({ sampleId: 'ID8live01' })).status, 'preparing');
  missing.advance(7 * 60_000); missing.setItems([car('ID8old001'), car('ID8next01')]);
  const canceled = await missing.stories.run();
  assert.equal(canceled.status, 'canceled'); assert.equal(canceled.reason, 'stock_entry_missing');
  assert.equal(missing.ledger().active, null); assert.equal(missing.posts().length, 0); assert.equal(missing.deletes().length, 0);
  missing.setContainerStatus('FINISHED');
  assert.equal((await missing.stories.run()).id, 'ID8next01'); assert.equal(missing.posts().length, 1);
});

test('unknown publish outcomes block automatic retries and later cars', async () => {
  for (const outcome of ['transport', 'invalid', 'rejected']) {
    const f = fixture(); f.setPublishResult(outcome);
    await assert.rejects(f.stories.run({ sampleId: 'ID8live01' }));
    assert.equal(f.ledger().active.phase, 'unknown');
    f.setItems([...f.getItems(), car('ID8next01')]);
    assert.equal((await f.stories.run()).status, 'review_required'); assert.equal(f.posts().length, 1);
  }
  const failedCommit = fixture(); failedCommit.setLedgerWriteHook(state => { if (state.lastResult?.status === 'published') throw new Error('Durable confirmation write failed'); });
  await assert.rejects(failedCommit.stories.run({ sampleId: 'ID8live01' }), /Durable confirmation write failed/);
  assert.equal(failedCommit.ledger().active.phase, 'publishing');
  assert.equal((await failedCommit.stories.run()).status, 'review_required'); assert.equal(failedCommit.posts().length, 1);
  const publishedContainer = fixture(); publishedContainer.setContainerStatus('PUBLISHED');
  assert.equal((await publishedContainer.stories.run({ sampleId: 'ID8live01' })).status, 'review_required');
  assert.equal(publishedContainer.ledger().active.phase, 'unknown');
  assert.equal((await publishedContainer.stories.run()).status, 'review_required'); assert.equal(publishedContainer.posts().length, 0);
});

test('explicit unavailable Story is deleted by the recorded Facebook ID and never twice', async () => {
  const f = fixture(); await f.stories.run({ sampleId: 'ID8live01' }); const mediaId = f.ledger().items.ID8live01.mediaId;
  f.setItems([car('ID8live01', { availability: 'out of stock' }), car('ID8old001')]);
  await f.stories.run(); assert.equal(f.ledger().items.ID8live01.status, 'retired');
  assert.equal(f.deletes().length, 1); assert.equal(new URL(f.deletes()[0].url).pathname.split('/').at(-1), mediaId);
  await f.stories.run(); assert.equal(f.deletes().length, 1);
});

test('wrong deleted_id leaves an unknown intent and cannot trigger repeated deletion', async () => {
  const f = fixture(); await f.stories.run({ sampleId: 'ID8live01' }); f.setDeleteResult('wrong-id');
  f.setItems([car('ID8live01', { availability: 'out of stock' }), car('ID8old001')]);
  await assert.rejects(f.stories.run(), { code: 'story_delete_unknown' });
  assert.equal(f.ledger().active.phase, 'unknown'); assert.equal((await f.stories.run()).status, 'review_required'); assert.equal(f.deletes().length, 1);
  const failedCommit = fixture(); await failedCommit.stories.run({ sampleId: 'ID8live01' });
  failedCommit.setItems([car('ID8live01', { availability: 'out of stock' }), car('ID8old001')]);
  failedCommit.setLedgerWriteHook(state => { if (state.lastResult?.status === 'retired') throw new Error('Durable retirement write failed'); });
  await assert.rejects(failedCommit.stories.run(), /Durable retirement write failed/);
  assert.equal(failedCommit.ledger().active.phase, 'deleting');
  assert.equal((await failedCommit.stories.run()).status, 'review_required'); assert.equal(failedCommit.deletes().length, 1);
});

test('changed price retires an active Story while absent records never authorize deletion', async () => {
  const price = fixture(); await price.stories.run({ sampleId: 'ID8live01' });
  price.setItems([car('ID8live01', { price: '33990.00 EUR' }), car('ID8old001')]); await price.stories.run();
  assert.equal(price.ledger().items.ID8live01.reason, 'vehicle_details_changed'); assert.equal(price.deletes().length, 1);
  const absent = fixture(); await absent.stories.run({ sampleId: 'ID8live01' }); absent.setItems([car('ID8old001')]); await absent.stories.run();
  assert.equal(absent.deletes().length, 0); assert.equal(absent.ledger().items.ID8live01.status, 'published');
});

test('changed ledger account binding is rejected before further rendering or publishing', async () => {
  const f = fixture(); await f.stories.run(); f.rewriteLedger(state => { state.facebookId = '17841488880000000'; });
  await assert.rejects(f.stories.run({ sampleId: 'ID8live01' }), { code: 'story_binding_changed' });
  assert.equal(f.posts().length, 0); assert.equal(f.renders.length, 0);
});
