import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInstagramRetirements } from '../lib/instagram-retirements.js';
import { createInstagramSyncHandler } from '../lib/instagram-sync-handler.js';
import { createInstagramPublisher } from '../lib/instagram-publisher.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const publicationPath = 'instagram/v1/production/state.json';
const retirementPath = 'instagram/v1/production/retirements.json';
const headers = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const car = (id, availability = 'out of stock') => ({ id, title: 'Mercedes-Benz GLE', description: '2022 | 42 000 km', availability, condition: 'used', price: '56990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/mercedes-${id}.html`, image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;q=100;s=600x0`, brand: 'Mercedes-Benz' });
const csv = (items) => [headers, ...items.map((item) => headers.map((key) => item[key]))].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
const permalink = (id) => `https://www.instagram.com/p/Post${id}/`;
const media = (id = 'ID8sold01', overrides = {}) => ({ id: '880000001', caption: `${car(id).title}\n${car(id).link}`, permalink: permalink(id), ...overrides });

function fixture(options = {}) {
  const memory = memoryBlob();
  const calls = [];
  const env = {
    VERCEL_ENV: 'production', INSTAGRAM_USER_ID: '17841400000000000', INSTAGRAM_LOGIN_MODE: 'instagram',
    INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic-test/export?format=csv&gid=0',
    INSTAGRAM_RETIREMENTS_ENABLED: 'true', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'synthetic-facebook-token-never-log',
    INSTAGRAM_RETIREMENTS_PAGE_ID: '99111100000000', INSTAGRAM_RETIREMENTS_USER_ID: '17841499990000000',
    INSTAGRAM_RETIREMENTS_GRAPH_VERSION: 'v27.0', ...options.env,
  };
  let items = options.items || [car('ID8sold01'), car('ID8live01', 'in stock')];
  let rawFeed;
  let accountName = 'autovalorpt';
  let pageAccountId = env.INSTAGRAM_RETIREMENTS_USER_ID;
  let permissions = ['instagram_basic', 'instagram_manage_contents'];
  let mediaPages = [[media()]];
  let deleteResult = 'success';
  let clock = Date.now();
  let missingPermalink = false;
  let postLinkHook;
  let deletePause;
  let deleteHook;
  const state = {
    version: 1, accountId: env.INSTAGRAM_USER_ID, username: 'autovalorpt', loginMode: env.INSTAGRAM_LOGIN_MODE,
    sourceHash: createHash('sha256').update(env.INSTAGRAM_FEED_URL).digest('hex'), lastFeedCount: options.lastFeedCount || items.length,
    active: null, items: Object.fromEntries((options.published || ['ID8sold01', 'ID8live01']).map((id) => [id, { status: 'published', mediaId: `77${id === 'ID8sold01' ? '100000' : '200000'}`, updatedAt: new Date(clock).toISOString() }])),
  };
  memory.records.set(publicationPath, { text: JSON.stringify(state), etag: 'publication-seed' });
  const fetchImpl = async (address, settings = {}) => {
    const url = new URL(address);
    const method = settings.method || 'GET';
    calls.push({ url: url.href, method, body: settings.body });
    if (url.hostname === 'docs.google.com') return new Response(rawFeed ?? csv(items), { headers: { 'content-type': 'text/csv' } });
    assert.equal(url.hostname, 'graph.facebook.com');
    assert.equal(settings.headers.Authorization, `Bearer ${env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN}`);
    assert.equal(url.searchParams.has('access_token'), false);
    if (method === 'DELETE') {
      const deletionId = url.pathname.split('/').at(-1);
      assert.equal(url.pathname, `/v27.0/${deletionId}`);
      assert.ok(mediaPages.flat().some((entry) => entry.id === deletionId), 'Delete only a media ID from the verified own-media result');
      assert.ok(memory.records.has(retirementPath), 'Retirement intent must be saved before deletion');
      deleteHook?.();
      if (deletePause) { const waiting = deletePause; deletePause = undefined; await waiting; }
      if (deleteResult === 'transport') throw new Error('synthetic transport with secret must not leak');
      if (deleteResult === 'rejected') return Response.json({ error: { code: 10, message: 'private provider text must not leak' } }, { status: 403 });
      if (deleteResult === 'invalid') return Response.json({ unexpected: true });
      if (deleteResult === 'wrong-id') return Response.json({ success: true, deleted_id: '889999999' });
      if (deleteResult === 'missing-id') return Response.json({ success: true });
      return Response.json({ success: true, deleted_id: url.pathname.split('/').at(-1) });
    }
    if (url.pathname.endsWith('/me/permissions')) return Response.json({ data: permissions.map((permission) => ({ permission, status: 'granted' })) });
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_PAGE_ID}`)) return Response.json({ id: env.INSTAGRAM_RETIREMENTS_PAGE_ID, instagram_business_account: { id: pageAccountId, username: accountName } });
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_USER_ID}/media`)) {
      const page = Number(url.searchParams.get('after') || 0);
      return Response.json({ data: mediaPages[page] || [], ...(page + 1 < mediaPages.length ? { paging: { cursors: { after: String(page + 1) }, next: 'https://untrusted.example/should-not-follow?access_token=private' } } : {}) });
    }
    if (url.pathname.endsWith(`/${env.INSTAGRAM_RETIREMENTS_USER_ID}`)) return Response.json({ id: env.INSTAGRAM_RETIREMENTS_USER_ID, username: accountName });
    throw new Error(`Unexpected synthetic request path ${url.pathname}`);
  };
  const publisher = { postLink: async (id) => { postLinkHook?.(); return missingPermalink ? null : permalink(id); } };
  const retirements = createInstagramRetirements({ env, storage: memory.storage, fetchImpl, now: () => clock, publisher });
  return {
    retirements, memory, calls, env, state,
    deletes: () => calls.filter((call) => call.method === 'DELETE'),
    publication: () => JSON.parse(memory.records.get(publicationPath).text),
    setItems: (value) => { items = value; }, setRawFeed: (value) => { rawFeed = value; },
    setAccount: (value) => { accountName = value; }, setPageAccount: (value) => { pageAccountId = value; },
    setPermissions: (value) => { permissions = value; }, setMediaPages: (value) => { mediaPages = value; },
    setDeleteResult: (value) => { deleteResult = value; }, setMissingPermalink: (value) => { missingPermalink = value; },
    setPostLinkHook: (callback) => { postLinkHook = callback; },
    setDeletePause: (promise) => { deletePause = promise; }, setDeleteHook: (callback) => { deleteHook = callback; },
    advance: (milliseconds) => { clock += milliseconds; },
  };
}

async function blocked(run) {
  let result;
  try { result = await run(); }
  catch (error) { return { error: error.code || error.message }; }
  assert.notEqual(result?.status, 'retired');
  return result;
}

test('retirement defaults disabled without consulting credentials, feed, or provider', async () => {
  const f = fixture({ env: { INSTAGRAM_RETIREMENTS_ENABLED: undefined } });
  assert.deepEqual(await f.retirements.run(), { ok: true, status: 'disabled', retired: 0 });
  assert.equal(f.calls.length, 0);
  assert.equal(f.memory.calls.length, 0);
});

test('explicit sold stock deletes only the verified Facebook media and preserves publication history', async () => {
  const f = fixture();
  const original = f.memory.records.get(publicationPath).text;
  const result = await f.retirements.run();
  assert.equal(result.status, 'retired');
  assert.equal(result.retired, 1);
  assert.equal(f.deletes().length, 1);
  assert.match(f.deletes()[0].url, /\/880000001$/);
  assert.equal(f.memory.records.get(publicationPath).text, original);
  assert.equal(f.publication().items.ID8sold01.status, 'published');
  await f.retirements.run();
  assert.equal(f.deletes().length, 1, 'A recorded retirement is not repeated');
});

test('discontinued stock is a retirement candidate while absent and available IDs are not', async () => {
  const f = fixture({ items: [car('ID8sold01', 'discontinued'), car('ID8live01', 'in stock')], published: ['ID8sold01', 'ID8live01', 'ID8absent'] });
  assert.equal((await f.retirements.run()).status, 'retired');
  await f.retirements.run();
  assert.equal(f.deletes().length, 1);
  assert.equal(f.publication().items.ID8absent.status, 'published');
});

test('missing sold record never triggers deletion merely because it disappeared from feed', async () => {
  const f = fixture(); f.setItems([car('ID8live01', 'in stock')]);
  await f.retirements.run();
  assert.equal(f.deletes().length, 0);
});

test('sold vehicles never published by this integration are not deletion candidates', async () => {
  const f = fixture({ published: ['ID8live01'] });
  await f.retirements.run();
  assert.equal(f.deletes().length, 0);
});

test('dry run evaluates matching without writing state or deleting media', async () => {
  const f = fixture();
  const before = [...f.memory.records.entries()].map(([path, entry]) => [path, entry.text]);
  await f.retirements.dryRun();
  assert.equal(f.deletes().length, 0);
  assert.deepEqual([...f.memory.records.entries()].map(([path, entry]) => [path, entry.text]), before);
});

test('missing deletion permission, wrong account, and wrong page association all fail closed', async () => {
  for (const alter of [
    (f) => f.setPermissions(['instagram_basic']),
    (f) => f.setPermissions(['instagram_manage_contents']),
    (f) => f.setAccount('different_business'),
    (f) => f.setPageAccount('17841488880000000'),
  ]) {
    const f = fixture(); alter(f);
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 0);
  }
});

test('preview, unsupported v26 API, and missing separate Facebook authorization cannot delete posts', async () => {
  for (const env of [{ VERCEL_ENV: 'preview' }, { INSTAGRAM_RETIREMENTS_GRAPH_VERSION: 'v26.0' }, { INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: '' }]) {
    const f = fixture({ env }); await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 0);
  }
});

test('malformed, duplicate, and suspiciously partial feeds cannot trigger deletion', async () => {
  const malformed = fixture(); malformed.setRawFeed(csv([car('ID8sold01')]) + '\n"broken');
  const duplicate = fixture(); duplicate.setRawFeed(csv([car('ID8sold01'), car('ID8sold01')]));
  const partial = fixture({ lastFeedCount: 10 });
  for (const f of [malformed, duplicate, partial]) {
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 0);
  }
});

test('both the exact stable listing ID and publication permalink must match owned media', async () => {
  for (const entry of [
    media('ID8other1', { permalink: permalink('ID8sold01') }),
    media('ID8sold01', { permalink: permalink('ID8other1') }),
    media('ID8sold01', { caption: 'https://www.standvirtual.com.evil.example/carros/anuncio/car-ID8sold01.html' }),
    media('ID8sold01', { caption: 'https://www.standvirtual.com/carros/anuncio/car-ID8sold01extra.html' }),
  ]) {
    const f = fixture(); f.setMediaPages([[entry]]);
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 0);
  }
});

test('ambiguous media matches and unresolvable original permalink require review', async () => {
  const duplicate = fixture(); duplicate.setMediaPages([[media(), media('ID8sold01', { id: '880000002' })]]);
  const missing = fixture(); missing.setMissingPermalink(true);
  for (const f of [duplicate, missing]) {
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 0);
  }
});

test('owned media pagination uses validated cursors without following provider URLs', async () => {
  const f = fixture(); f.setMediaPages([[media('ID8other1')], [media()]]);
  assert.equal((await f.retirements.run()).status, 'retired');
  assert.equal(f.deletes().length, 1);
  assert.equal(f.calls.some((call) => new URL(call.url).hostname === 'untrusted.example'), false);
});

test('concurrent retirements acquire one exclusive deletion intent', async () => {
  const f = fixture();
  await Promise.allSettled([f.retirements.run(), f.retirements.run()]);
  assert.equal(f.deletes().length, 1);
  await f.retirements.run();
  assert.equal(f.deletes().length, 1);
});

test('unknown, rejected, malformed, and wrong-ID delete results are never reported retired or automatically retried', async () => {
  for (const outcome of ['transport', 'rejected', 'invalid', 'wrong-id', 'missing-id']) {
    const f = fixture(); f.setDeleteResult(outcome);
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 1);
    f.setDeleteResult('success'); f.advance(2 * 86400_000);
    await blocked(() => f.retirements.run());
    assert.equal(f.deletes().length, 1);
    const status = JSON.stringify(await f.retirements.status());
    assert.equal(status.includes(f.env.INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN), false);
    assert.equal(status.includes('private provider text'), false);
    assert.equal(status.includes('synthetic transport'), false);
  }
});

test('a car restored to stock during provider discovery is not deleted', async () => {
  const f = fixture();
  f.setPostLinkHook(() => f.setItems([car('ID8sold01', 'in stock'), car('ID8live01', 'in stock')]));
  assert.equal((await f.retirements.run()).status, 'canceled');
  assert.equal(f.deletes().length, 0);
  assert.equal(f.memory.records.has(retirementPath), false);
});

test('lost persistence after successful DELETE cannot produce a repeated DELETE', async () => {
  const f = fixture();
  f.memory.faults.put = (path, state) => path === retirementPath && Object.values(state.items || {}).some((item) => item.status === 'retired');
  await assert.rejects(f.retirements.run());
  assert.equal(f.deletes().length, 1);
  f.memory.faults.put = null;
  f.advance(2 * 86400_000);
  assert.equal((await f.retirements.run()).status, 'review_required');
  assert.equal(f.deletes().length, 1);
  assert.equal(f.publication().items.ID8sold01.status, 'published');
});

test('publication state must be bound to the current account and original full feed', async () => {
  for (const overrides of [{ accountId: '17841412345000000' }, { sourceHash: 'different-source' }, { loginMode: 'facebook' }]) {
    const f = fixture();
    f.memory.records.set(publicationPath, { text: JSON.stringify({ ...f.state, ...overrides }), etag: 'publication-seed' });
    await assert.rejects(f.retirements.run(), { code: 'retirement_binding_changed' });
    assert.equal(f.deletes().length, 0);
  }
});

test('incomplete owned-media pagination is not accepted as a unique match', async () => {
  const f = fixture();
  f.setMediaPages([[media()], ...Array.from({ length: 5 }, () => [media('ID8other1')])]);
  await assert.rejects(f.retirements.run(), { code: 'retirement_media_incomplete' });
  assert.equal(f.deletes().length, 0);
});

test('retirement endpoints require private access and mutations require cron or same-origin admin POST', async () => {
  let retireRuns = 0;
  let publicationRuns = 0;
  const secret = 'synthetic-cron-secret-at-least-32-characters';
  const handler = createInstagramSyncHandler({
    env: { CRON_SECRET: secret }, authorizeAdmin: (req) => req.headers.cookie === 'synthetic-admin',
    publisher: { run: async () => { publicationRuns++; return { ok: true, status: 'no_new_stock', published: 0 }; } },
    retirements: { status: async () => ({ ok: true }), dryRun: async () => ({ ok: true }), run: async () => { retireRuns++; return { ok: true, status: 'no_retirements', retired: 0 }; } },
  });
  const invoke = async (action, method = 'GET', headers = {}) => {
    const response = { statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, query: { action }, headers }, response);
    return response;
  };
  for (const action of ['retirement-status', 'retirement-dry-run', 'retirement-run']) assert.equal((await invoke(action)).statusCode, 401);
  assert.equal((await invoke('retirement-run', 'GET', { cookie: 'synthetic-admin' })).statusCode, 403);
  assert.equal((await invoke('retirement-run', 'POST', { cookie: 'synthetic-admin', origin: 'https://untrusted.example', host: 'autovalorpt-assistente.vercel.app' })).statusCode, 403);
  assert.equal(retireRuns, 0);
  assert.equal((await invoke('retirement-run', 'POST', { cookie: 'synthetic-admin', origin: 'https://autovalorpt-assistente.vercel.app', host: 'autovalorpt-assistente.vercel.app' })).statusCode, 200);
  assert.equal(retireRuns, 1);
  assert.equal((await invoke('retirement-run', 'GET', { authorization: `Bearer ${secret}` })).statusCode, 200);
  assert.equal(retireRuns, 2);
  assert.equal((await invoke('run', 'GET', { authorization: `Bearer ${secret}` })).statusCode, 200);
  assert.equal(publicationRuns, 1);
  assert.equal(retireRuns, 2, 'The existing publication cron must not silently activate retirement');
});

test('public permalink lookup suppresses a retired post without changing its publication registry', async () => {
  const f = fixture();
  await f.retirements.run();
  const publisher = createInstagramPublisher({ env: f.env, storage: f.memory.storage,
    fetchImpl: async () => { throw new Error('Retired post must not query Meta again'); },
    tokenManager: { resolve: async () => { throw new Error('Retired post needs no publisher token'); }, status: async () => ({}) },
  });
  assert.equal(await publisher.postLink('ID8sold01'), null);
  assert.equal(f.publication().items.ID8sold01.status, 'published');
});

test('public permalink lookup fails closed on malformed and unbound retirement ledgers', async () => {
  for (const invalid of ['{', { accountId: '17841411110000000' }, { sourceHash: 'another-feed' }, { version: 2 }, { items: null }, { items: [] }, { items: 'invalid' }]) {
    const f = fixture();
    const valid = { version: 1, accountId: f.env.INSTAGRAM_USER_ID, sourceHash: f.state.sourceHash, items: {} };
    f.memory.records.set(retirementPath, { text: typeof invalid === 'string' ? invalid : JSON.stringify({ ...valid, ...invalid }), etag: 'retirement-seed' });
    let reads = 0;
    const publisher = createInstagramPublisher({ env: f.env, storage: f.memory.storage,
      fetchImpl: async () => { reads++; return Response.json({ permalink: permalink('ID8live01') }); },
      tokenManager: { resolve: async () => 'synthetic-token', status: async () => ({}) },
    });
    await assert.rejects(publisher.postLink('ID8live01'));
    assert.equal(reads, 0, 'Malformed retirement evidence must not forward traffic to a possibly removed post');
  }
});

test('a different active published post keeps its verified public permalink after a retirement', async () => {
  const f = fixture();
  await f.retirements.run();
  const seen = [];
  const publisher = createInstagramPublisher({ env: f.env, storage: f.memory.storage,
    fetchImpl: async (address) => { seen.push(address); return Response.json({ permalink: permalink('ID8live01') }); },
    tokenManager: { resolve: async () => 'synthetic-token', status: async () => ({}) },
  });
  assert.equal(await publisher.postLink('ID8live01'), permalink('ID8live01'));
  assert.equal(seen.length, 1);
  assert.match(new URL(seen[0]).pathname, /\/77200000$/);
  assert.equal(f.publication().items.ID8live01.status, 'published');
});

test('another sold vehicle cannot be deleted while the first DELETE is in flight', async () => {
  const f = fixture({ items: [car('ID8sold01'), car('ID8sold02')], published: ['ID8sold01', 'ID8sold02'] });
  f.setMediaPages([[media(), media('ID8sold02', { id: '880000002' })]]);
  let release;
  let started;
  f.setDeletePause(new Promise((resolve) => { release = resolve; }));
  const entered = new Promise((resolve) => { started = resolve; });
  f.setDeleteHook(() => started());
  const first = f.retirements.run();
  await entered;
  try {
    const second = await f.retirements.run();
    assert.equal(second.status, 'review_required');
    assert.equal(second.id, 'ID8sold01');
    assert.equal(f.deletes().length, 1);
  } finally { release(); }
  const result = await first;
  assert.equal(result.status, 'retired');
  assert.equal(result.retired, 2);
  assert.equal(f.deletes().length, 2);
  assert.equal(new Set(f.deletes().map((call) => call.url)).size, 2, 'The first batch may finish both vehicles without duplication');
});

test('an unknown deletion blocks other sold candidates until reconciliation', async () => {
  const f = fixture({ items: [car('ID8sold01'), car('ID8sold02')], published: ['ID8sold01', 'ID8sold02'] });
  f.setMediaPages([[media(), media('ID8sold02', { id: '880000002' })]]);
  f.setDeleteResult('transport');
  assert.equal((await f.retirements.run()).status, 'unknown');
  f.setDeleteResult('success');
  const next = await f.retirements.run();
  assert.equal(next.status, 'review_required');
  assert.equal(next.id, 'ID8sold01');
  assert.equal(f.deletes().length, 1);
});

test('separate daily retirement cron precedes the unchanged Instagram publication cron', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const retire = config.crons.filter((entry) => entry.path === '/api/stock?integration=instagram-sync&action=retirement-run');
  const publish = config.crons.filter((entry) => entry.path === '/api/stock?integration=instagram-sync&action=run');
  assert.equal(retire.length, 1);
  assert.equal(retire[0].schedule, '0 9 * * *');
  assert.equal(publish.length, 1);
  assert.equal(publish[0].schedule, '0 10 * * *');
});

test('one retirement run removes all explicitly sold verified candidates within its batch', async () => {
  const f = fixture({ items: [car('ID8sold01'), car('ID8sold02')], published: ['ID8sold01', 'ID8sold02'] });
  f.setMediaPages([[media(), media('ID8sold02', { id: '880000002' })]]);
  const original = f.memory.records.get(publicationPath).text;
  const result = await f.retirements.run();
  assert.equal(result.status, 'retired');
  assert.equal(result.retired, 2);
  assert.equal(f.deletes().length, 2);
  assert.deepEqual(new Set(f.deletes().map((call) => new URL(call.url).pathname)), new Set(['/v27.0/880000001', '/v27.0/880000002']));
  assert.equal(f.memory.records.get(publicationPath).text, original);
  await f.retirements.run();
  assert.equal(f.deletes().length, 2);
});

test('batch cap retires ten verified vehicles and reports the remaining one without losing it', async () => {
  const ids = Array.from({ length: 11 }, (_, index) => `ID8sold${String(index + 1).padStart(2, '0')}`);
  const f = fixture({ items: ids.map((id) => car(id)), published: ids });
  f.setMediaPages([ids.map((id, index) => media(id, { id: String(880000001 + index) }))]);
  const first = await f.retirements.run();
  assert.equal(first.retired, 10);
  assert.equal(first.remaining, 1);
  assert.equal(f.deletes().length, 10);
  const second = await f.retirements.run();
  assert.equal(second.retired, 1);
  assert.equal(second.remaining, 0);
  assert.equal(f.deletes().length, 11);
  assert.equal(new Set(f.deletes().map((call) => call.url)).size, 11);
});

test('the shared execution budget stops a batch before claiming another deletion', async (context) => {
  let simulatedTime = Date.now();
  context.mock.method(Date, 'now', () => simulatedTime);
  const f = fixture({ items: [car('ID8sold01'), car('ID8sold02')], published: ['ID8sold01', 'ID8sold02'] });
  f.setMediaPages([[media(), media('ID8sold02', { id: '880000002' })]]);
  f.setDeleteHook(() => { simulatedTime += 28_000; });
  const first = await f.retirements.run();
  assert.equal(first.retired, 1);
  assert.equal(first.remaining, 1);
  assert.equal(f.deletes().length, 1);
  const ledger = JSON.parse(f.memory.records.get(retirementPath).text);
  assert.equal(ledger.items.ID8sold01.status, 'retired');
  assert.equal(ledger.items.ID8sold02, undefined);
});
