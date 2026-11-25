import test from 'node:test';
import assert from 'node:assert/strict';
import { createElectricDrafts } from '../lib/electric-editorial-drafts.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const post = { id: 'editorial-extra-2026-11-28-eletrico-cabo', date: '2026-11-28', electric: true, slides: [{ title: 'Cabo' }] };
const path = 'instagram/editorial/v1/production/electric-drafts/' + post.id + '.json';
const approved = { caption: 'Legenda verificada.', sources: [{ label: 'Fonte pública', url: 'https://example.org/artigo', date: '2026-11-26' }] };
function latch() {
  let open;
  const wait = new Promise(resolve => { open = resolve; });
  return { wait, open };
}
function create(storage, prepare, options = {}) {
  return createElectricDrafts({ storage, prepare, namespace: 'production', ...options });
}

test('only electric posts perform IO; an immutable dated draft merges caption/sources without replacing each caller’s slides', async () => {
  const m = memoryBlob();
  let calls = 0;
  const frozen = create(m.storage, async () => { calls++; return { ...approved, slides: ['wrong'] }; });
  const legacy = { ...post, electric: false };
  assert.equal(await frozen(legacy), legacy);
  assert.equal(m.calls.length, 0);
  const alternateVisuals = { ...post, slides: [{ title: 'Outra disposição' }] };
  const [a, b] = await Promise.all([frozen(post), frozen(alternateVisuals)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, { ...post, ...approved });
  assert.deepEqual(b, { ...alternateVisuals, ...approved });
  assert.deepEqual([...m.records.keys()], [path]);
  const writes = m.calls.filter(x => x.method === 'put');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].options.allowOverwrite, false);
  assert.ok(writes[1].options.ifMatch);
  const resumed = create(m.storage, () => { throw new Error('must reuse'); });
  assert.deepEqual(await resumed(post), a);
  assert.equal(m.calls.at(-1).method, 'get');
  assert.equal(m.calls.filter(x => x.method === 'list').length, 0);
});

test('separate processes review the same winner after a conflicting first claim', async () => {
  const m = memoryBlob(), entered = latch(), resume = latch();
  let calls = 0;
  const winner = create(m.storage, async () => { calls++; entered.open(); await resume.wait; return approved; });
  const first = winner(post);
  await entered.wait;
  let waits = 0;
  const other = create(m.storage, () => { throw new Error('loser should not prepare'); }, {
    pause: async () => { waits++; resume.open(); await first; },
  });
  const second = await other(post);
  assert.equal(calls, 1);
  assert.equal(waits, 1);
  assert.deepEqual(second, await first);
});

test('active lease produces a bounded retryable result; its abandoned holder can be replaced only after expiration', async () => {
  const m = memoryBlob(), entered = latch(), resume = latch();
  let time = Date.now();
  const stale = create(m.storage, async () => { entered.open(); await resume.wait; return { caption: 'Texto anterior', sources: [] }; }, { now: () => time });
  const delayed = stale(post);
  await entered.wait;
  let waits = 0, calls = 0;
  const replacement = create(m.storage, async () => { calls++; return approved; }, { now: () => time, pause: async () => { waits++; } });
  await assert.rejects(replacement(post), { code: 'editorial_draft_preparing' });
  assert.equal(waits, 3);
  assert.equal(calls, 0);
  time += 15001;
  const taken = await replacement(post);
  resume.open();
  assert.deepEqual(await delayed, taken);
  assert.deepEqual(JSON.parse(m.records.get(path).text).sources, approved.sources);
  assert.equal(calls, 1);
});

test('an acknowledgement lost after commit, or one transient failure before commit, never changes the published draft', async () => {
  for (const applied of [false, true]) {
    const m = memoryBlob(), write = m.storage.put;
    let calls = 0, interrupted = false;
    m.storage.put = async (key, body, options) => {
      if (!interrupted && JSON.parse(body).status === 'ready') {
        interrupted = true;
        if (applied) await write(key, body, options);
        throw new Error('network');
      }
      return write(key, body, options);
    };
    const prepare = create(m.storage, async () => { calls++; return approved; });
    assert.deepEqual(await prepare(post), { ...post, ...approved });
    assert.deepEqual(await prepare(post), { ...post, ...approved });
    assert.equal(calls, 1);
  }
});

test('unsafe identities, malformed prepared content, and corrupted stored bindings cannot become published drafts', async () => {
  const m = memoryBlob();
  const prepare = create(m.storage, () => approved);
  for (const overrides of [{ id: 'x/../../private' }, { id: 'missing-date' }])
    await assert.rejects(prepare({ ...post, ...overrides }), { code: 'editorial_draft_identity_invalid' });
  assert.equal(m.calls.length, 0);
  for (const fields of [{ caption: ' '.repeat(3), sources: [] }, { caption: 'ok', sources: [{}] },
    { caption: 'ok', sources: [{ label: 'Fonte', url: 'https://user:pass@example.org' }] }, { caption: 'ok', sources: [{ label: 'Fonte', url: 'javascript:foo' }] }]) {
    const own = memoryBlob(), frozen = create(own.storage, () => fields);
    await assert.rejects(frozen(post), { code: 'editorial_draft_invalid' });
    assert.equal(JSON.parse(own.records.get(path).text).status, 'preparing');
  }
  m.records.set(path, { text: JSON.stringify({ version: 1, id: post.id, date: '2026-11-26', status: 'ready', ...approved }), etag: 'seed' });
  await assert.rejects(prepare(post), { code: 'editorial_draft_invalid' });
  assert.equal(m.calls.filter(x => x.method === 'put').length, 0);
});

test('two cold processes with an initial cache miss have just one conditional-claim winner and one preparation', async () => {
  const m = memoryBlob();
  let calls = 0;
  const run = () => create(m.storage, async () => { calls++; return approved; }, {
    pause: () => new Promise(resolve => setImmediate(resolve)),
  })(post);
  const [a, b] = await Promise.all([run(), run()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(m.calls.filter(x => x.method === 'put' && x.options.allowOverwrite === false).length, 2);
});

test('eight recently used drafts need no Blob reads on refresh, no caller can change the cached sources', async () => {
  const m = memoryBlob();
  let prepared = 0;
  const frozen = create(m.storage, async () => { prepared++; return approved; });
  const posts = Array.from({ length: 9 }, (_, index) => ({ ...post, id: post.id + '-' + index }));
  await Promise.all(posts.slice(0, 8).map(frozen));
  const before = m.calls.length;
  const a = await frozen(posts[0]);
  a.sources[0].url = 'https://example.org/edited';
  a.sources.length = 0;
  const b = await frozen(posts[0]);
  assert.deepEqual(b.sources, approved.sources);
  assert.equal(m.calls.length, before);
  await frozen(posts[8]);
  const after = m.calls.length;
  await frozen(posts[0]);
  assert.equal(m.calls.length, after);
  await frozen(posts[1]);
  assert.equal(m.calls.length, after + 1);
  assert.equal(m.calls.at(-1).method, 'get');
  assert.equal(prepared, 9);
});

test('a transient read failure cannot enter the warm cache', async () => {
  const m = memoryBlob();
  const frozen = create(m.storage, () => approved);
  m.faults.get = () => true;
  await assert.rejects(frozen(post), /read failure/);
  delete m.faults.get;
  assert.deepEqual(await frozen(post), { ...post, ...approved });
});
