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
const permalink = id => `https://www.instagram.com/p/Post${id}/`;

function fixture() {
  const memory = memoryBlob();
  const env = {
    VERCEL_ENV: 'production', INSTAGRAM_LOGIN_MODE: 'instagram', INSTAGRAM_USER_ID: '17841400000000000',
    INSTAGRAM_FEED_URL: 'https://docs.google.com/spreadsheets/d/synthetic-test/export?format=csv&gid=0',
    INSTAGRAM_RETIREMENTS_ENABLED: 'true', INSTAGRAM_RETIREMENTS_USER_ID: '17841499990000000',
    INSTAGRAM_RETIREMENTS_PAGE_ID: '99111100000000', INSTAGRAM_RETIREMENTS_FACEBOOK_ACCESS_TOKEN: 'test',
  };
  const state = {
    version: 1, accountId: env.INSTAGRAM_USER_ID, username: 'autovalorpt', loginMode: 'instagram',
    sourceHash: createHash('sha256').update(env.INSTAGRAM_FEED_URL).digest('hex'),
    items: { ID8sold01: { status: 'published', mediaId: '77100000' }, ID8live01: { status: 'published', mediaId: '77200000' } },
  };
  memory.records.set(publicationPath, { text: JSON.stringify(state), etag: 'publication-seed' });
  // Some production history predates permanent retention.
  const legacyLedger = { version: 1, accountId: state.accountId, sourceHash: state.sourceHash,
    items: { ID8sold01: { status: 'retired' } } };
  memory.records.set(retirementPath, { text: JSON.stringify(legacyLedger), etag: 'retirement-seed' });
  return { env, memory, state, publication: () => JSON.parse(memory.records.get(publicationPath).text) };
}

test('legacy retirement actions preserve Instagram history even with the old deletion flag enabled', async () => {
  const { env, memory } = fixture();
  const original = structuredClone(memory.records);
  const unexpected = () => assert.fail('The history step should not access the provider or stock');
  const retirements = createInstagramRetirements({ env, storage: memory.storage, fetchImpl: unexpected, loadFeed: unexpected });
  const [status, plan, run, repeated] = await Promise.all([retirements.status(), retirements.dryRun(), retirements.run(), retirements.run()]);
  assert.equal(status.configuration.enabled, false);
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(run, { ok: true, status: 'disabled', retired: 0 });
  assert.deepEqual(repeated, run);
  assert.deepEqual(memory.records, original);
  assert.deepEqual(memory.calls, []);
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

test('retirements are now coordinated in the morning flow rather than an independent cron', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const retire = config.crons.filter((entry) => entry.path === '/api/stock?integration=instagram-sync&action=retirement-run');
  const publish = config.crons.filter((entry) => entry.path === '/api/stock?integration=instagram-sync&action=run');
  assert.equal(retire.length, 0);
  assert.equal(publish.length, 0);
  assert.equal(config.crons.filter(entry => entry.path.includes('integration=morning-flow')).length, 2);
});
