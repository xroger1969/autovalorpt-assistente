import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../manual-stories.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const stock = [
  { id: 'ID8demo01', title: 'Citroën ë-C4', brand: 'Citroën', model: 'ë-C4', plate: 'AB-12-CD', price: '15990 EUR', sources: ['Samucar'] },
  { id: 'ID8demo02', title: 'Renault Zoe', brand: 'Renault', model: 'Zoe', price: '12990 EUR', sources: ['AutoValorPT'] }
];
const fingerprint = 'f'.repeat(64);
const jobId = '12345678-1234-4234-8234-123456789abc';
function preview(id) {
  const videoUrl = '/api/stock?integration=instagram-video&id=' + id + '&fingerprint=' + fingerprint;
  return { ok: true, id, fingerprint, reviewToken: 'review-' + id, status: 'preview_ready', publicationStatus: 'ready',
    publicationEnabled: true, videoUrl, downloadUrl: videoUrl + '&download=1' };
}

class Element {
  constructor() {
    this.value = ''; this.children = []; this.events = new Map(); this.dataset = {};
  }
  addEventListener(type, handler) { this.events.set(type, [...(this.events.get(type) || []), handler]); }
  emit(type) { for (const handler of this.events.get(type) || []) handler(); }
  appendChild(child) { this.children.push(child); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  hasAttribute(key) { return Object.hasOwn(this, key); }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  querySelectorAll() { return []; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  focus() {}
  pause() { this.paused = true; }
  load() { this.readyState = 0; }
}

function dashboard(overrides = {}, storage = new Map(), collapsible = false, preparationStorage = storage) {
  const elements = new Map(); const calls = [];
  const timers = new Map(); let nextTimer = 0;
  const documentEvents = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }
  const handlers = { stock: () => ({ ok: true, items: stock }),
    create: ({ id }) => ({ ok: true, status: 'preparing', id, jobId }),
    progress: ({ id }) => ({ ...preview(id), jobId }),
    publish: ({ id }) => ({ id, status: 'published' }), ...overrides };
  const context = { document: { hidden: false, getElementById: element, createElement: () => new Element(),
    addEventListener: (name, callback) => documentEvents.set(name, callback) },
    fetch: async (url, options) => {
      const action = new URL(url, 'https://example.test').searchParams.get('action').replace('stories-manual-', '');
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ action, body }); const result = await handlers[action](body);
      return { ok: true, status: 200, json: async () => result };
    }, location: { origin: 'https://example.test' }, URL, AbortController,
    clearTimeout: id => timers.delete(id), setTimeout: (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    localStorage: { getItem: key => preparationStorage.get(key), setItem: (key, value) => preparationStorage.set(key, value), removeItem: key => preparationStorage.delete(key) },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  if (collapsible) element('manualStories').setAttribute('data-collapsible-preview', '');
  vm.runInNewContext(script, context);
  context.AutoValorManualStories.setSession(true);
  const click = id => element(id).emit('click');
  const results = () => element('vehicleResults').children;
  async function open() { click('chooseVehicle'); await flush(); }
  async function select(index, loadMedia = true) {
    results()[index].children[0].emit('click'); await flush();
    if (!loadMedia) return;
    const player = element('vehicleVideo');
    player.readyState = 1; player.currentSrc = new URL(player.src, context.location.origin).href;
    player.emit('loadedmetadata');
  }
  async function tick(delay = 8000) {
    for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    await flush();
  }
  function visibility(hidden) { context.document.hidden = hidden; documentEvents.get('visibilitychange')?.(); }
  return { element, click, open, select, calls, results, tick, visibility, timers, setSession: context.AutoValorManualStories.setSession };
}

test('manual stock is fetched on demand and searched by make, model, ID and unformatted plate', async () => {
  const app = dashboard();
  assert.equal(app.calls.length, 0);
  await app.open();
  const input = app.element('vehicleSearch');
  for (const [value, matches] of [['', 2], ['citroen', 1], ['e-c4', 1], ['AB12CD', 1], ['ID8demo02', 1], ['sold', 0]]) {
    input.value = value; input.emit('input'); assert.equal(app.results().length, matches, value);
  }
  assert.deepEqual(app.calls.map(call => call.action), ['stock']);
});

test('preview/download and canceled confirmation never publish; repeated confirmation binds one request to the selected video', async () => {
  const app = dashboard(); await app.open(); await app.select(1);
  assert.match(app.element('vehicleDownload').href, /id=ID8demo02.*download=1/);
  app.click('publishStory');
  assert.match(app.element('confirmStoryText').textContent, /Renault Zoe.*ID8demo02.*@autovalorpt/);
  app.click('cancelStory'); app.click('sendStory');
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress']);
  app.click('publishStory'); app.click('sendStory'); app.click('sendStory'); await flush();
  assert.deepEqual(app.calls.filter(call => call.action === 'publish').map(call => call.body), [
    { id: stock[1].id, fingerprint, reviewToken: 'review-' + stock[1].id, confirmed: true }
  ]);
  assert.equal(app.element('publishStory').disabled, false);
  assert.equal(app.element('publishStory').textContent, 'Preparar novo Story desta viatura');
  app.click('publishStory'); app.click('publishStory'); await flush();
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress', 'publish', 'create', 'progress']);
  assert.equal(app.calls.at(-1).body.id, stock[1].id);
  assert.equal(app.element('confirmStory').open, false);
});

test('a lost publication response survives reload and only queries the original receipt', async () => {
  const storage = new Map();
  const first = dashboard({ publish() { throw new Error('disconnected'); } }, storage);
  const counts = [];
  first.setSession(true, undefined, (...args) => counts.push(args));
  await first.open(); await first.select(0);
  first.click('publishStory'); first.click('sendStory'); await flush();
  assert.equal(first.element('publishStory').disabled, true); assert.equal(storage.size, 1);
  assert.deepEqual(counts, [[0], [1]]);
  const next = dashboard({ status: input => ({ id: input.id, status: 'published' }) }, storage);
  const restoredCounts = [];
  next.setSession(true, undefined, (...args) => restoredCounts.push(args));
  assert.deepEqual(restoredCounts, [[1]]);
  assert.deepEqual(next.calls, []);
  next.element('pendingStories').children[0].emit('click'); await flush();
  assert.deepEqual(next.calls, [{ action: 'status', body: { id: stock[0].id, fingerprint, reviewToken: 'review-' + stock[0].id } }]);
  assert.equal(storage.size, 0);
  assert.deepEqual(restoredCounts, [[1], [0]]);
});

test('logout clears the pending count and detaches its listener without checking receipts', () => {
  const receipts = stock.map(({ id }) => ({ id, fingerprint, reviewToken: 'test-receipt' }));
  const storage = new Map([['autovalorpt.manual-stories.pending.v1', JSON.stringify(receipts)]]);
  const app = dashboard({}, storage);
  const counts = [];
  app.setSession(true, undefined, count => counts.push(count));
  app.setSession(false);
  app.setSession(true);
  assert.deepEqual(counts, [2, 0]);
  assert.equal(storage.size, 0);
  assert.deepEqual(app.calls, []);
});

test('the confirmation stays closed before the video loads and after a playback error', async () => {
  const app = dashboard(); await app.open(); await app.select(0, false);
  const player = app.element('vehicleVideo');
  assert.ok(app.element('publishStory').disabled);
  app.click('publishStory'); assert.ok(!app.element('confirmStory').open);
  player.readyState = 1; player.emit('loadedmetadata'); assert.equal(app.element('publishStory').disabled, false);
  player.error = { code: 4 }; player.emit('error'); assert.equal(app.element('publishStory').disabled, true);
  app.click('publishStory'); assert.ok(!app.element('confirmStory').open);
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress']);
});

test('the routine preview opens after selection, folds without fetching, pauses playback and resets on logout', async () => {
  const storage = new Map(); const app = dashboard({}, storage, true);
  const markup = app.element('manualStories').innerHTML;
  assert.match(markup, /<details id="vehiclePreview"[^>]*>\s*<summary id="vehicleName">/);
  assert.match(markup, /<\/details>\s*<p id="vehicleStatus"[\s\S]*id="pendingStories"/);
  const previewPanel = app.element('vehiclePreview'), player = app.element('vehicleVideo');
  assert.equal(previewPanel.hidden, true); assert.equal(previewPanel.open, false);
  await app.open(); await app.select(1);
  assert.equal(previewPanel.hidden, false); assert.equal(previewPanel.open, true);
  assert.equal(app.element('vehicleName').textContent, 'Vídeo preparado · Renault Zoe');
  const src = player.src, download = app.element('vehicleDownload').href;
  player.paused = false; previewPanel.open = false; previewPanel.emit('toggle');
  assert.equal(player.paused, true); assert.equal(app.element('vehicleStatus').textContent, '');
  previewPanel.open = true; previewPanel.emit('toggle');
  assert.equal(player.src, src); assert.equal(app.element('vehicleDownload').href, download);
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress']); assert.equal(storage.size, 0);
  app.setSession(false);
  assert.equal(previewPanel.open, false); assert.equal(previewPanel.hidden, true);
  assert.equal(player.hasAttribute('src'), false); assert.equal(app.element('vehicleDownload').hasAttribute('href'), false);
  assert.equal(app.element('vehicleName').textContent, 'Vídeo preparado');
});

test('the Stories page keeps the expanded video section and existing review prompt', async () => {
  const app = dashboard();
  assert.match(app.element('manualStories').innerHTML, /<section id="vehiclePreview"[^>]*>\s*<h2 id="vehicleName">/);
  await app.open(); await app.select(0);
  assert.equal(app.element('vehicleName').textContent, 'Citroën ë-C4');
  assert.equal(app.element('vehiclePreview').hidden, false);
  assert.match(app.element('vehicleStatus').textContent, /rever o vídeo/);
  assert.equal(app.element('vehiclePreview').events.has('toggle'), false);
});

test('a slow video is acknowledged, followed with short requests and shown only when complete', async () => {
  const storage = new Map(); let reads = 0;
  const app = dashboard({ progress: ({ id }) => ++reads === 1 ? { ok: true, id, jobId, status: 'preparing' } : { ...preview(id), jobId } }, storage);
  await app.open(); await app.select(0, false);
  assert.equal(app.element('vehiclePreview').hidden, true);
  assert.equal(app.element('chooseVehicle').disabled, true);
  assert.match(app.element('vehicleStatus').textContent, /Podes sair desta página/);
  assert.equal(storage.size, 1);
  await app.tick();
  assert.equal(app.element('vehiclePreview').hidden, false);
  assert.equal(app.element('chooseVehicle').disabled, false);
  assert.equal(storage.size, 0);
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress', 'progress']);
  assert.equal(app.calls.filter(call => call.action === 'publish').length, 0);
});

test('a dropped progress response has a Portuguese recovery action that checks the same job', async () => {
  let reads = 0;
  const app = dashboard({ progress: ({ id }) => {
    if (++reads === 1) throw new TypeError('Load failed');
    return { ...preview(id), jobId };
  } });
  await app.open(); await app.select(0, false);
  assert.doesNotMatch(app.element('vehicleStatus').textContent, /Load failed/);
  assert.match(app.element('vehicleStatus').textContent, /ligação ao servidor foi interrompida/);
  assert.equal(app.element('resumeVideo').hidden, false);
  app.click('resumeVideo'); await flush();
  assert.equal(app.element('vehiclePreview').hidden, false);
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress', 'progress']);
  assert.deepEqual(app.calls.at(-1).body, { id: stock[0].id, jobId });
});

test('reopening in a new tab recovers the saved video with progress only and never publishes', async () => {
  const storage = new Map();
  const first = dashboard({ progress: ({ id }) => ({ ok: true, id, jobId, status: 'preparing' }) }, new Map(), false, storage);
  await first.open(); await first.select(1, false);
  first.visibility(true);
  const next = dashboard({}, new Map(), false, storage); await flush();
  assert.deepEqual(next.calls, [{ action: 'progress', body: { id: stock[1].id, jobId } }]);
  assert.equal(next.element('vehiclePreview').hidden, false);
  assert.equal(next.element('vehicleName').textContent, 'Renault Zoe');
  assert.equal(storage.size, 0);
});

test('a lost creation acknowledgement preserves the selection for an explicit idempotent retry', async () => {
  let starts = 0; const storage = new Map();
  const app = dashboard({ create: ({ id }) => {
    if (++starts === 1) throw new TypeError('Load failed');
    return { ok: true, id, jobId, status: 'preparing' };
  } }, storage);
  await app.open(); await app.select(1, false);
  assert.equal(storage.size, 1);
  assert.equal(app.element('resumeVideo').hidden, false);
  app.click('resumeVideo'); await flush();
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'create', 'progress']);
  assert.equal(app.element('vehiclePreview').hidden, false);
  assert.equal(storage.size, 0);
});

test('an interrupted server job offers an explicit retry without endless polling', async () => {
  let reads = 0;
  const app = dashboard({ progress: ({ id }) => ++reads === 1 ?
    { ok: false, id, jobId, status: 'failed', reason: 'manual_video_job_interrupted' } : { ...preview(id), jobId } });
  await app.open(); await app.select(0, false);
  assert.match(app.element('vehicleStatus').textContent, /foi interrompida/);
  assert.equal(app.element('resumeVideo').textContent, 'Tentar criar novamente');
  await app.tick(); assert.equal(reads, 1);
  app.click('resumeVideo'); await flush();
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'create', 'progress', 'create', 'progress']);
  assert.equal(app.element('vehiclePreview').hidden, false);
});

test('a hidden page pauses progress polling and resumes on return', async () => {
  const app = dashboard({ progress: ({ id }) => ({ ok: true, id, jobId, status: 'preparing' }) });
  await app.open(); await app.select(0, false);
  app.visibility(true); await app.tick();
  assert.equal(app.calls.filter(call => call.action === 'progress').length, 1);
  app.visibility(false); await app.tick();
  assert.equal(app.calls.filter(call => call.action === 'progress').length, 2);
  app.setSession(false); await app.tick();
  assert.equal(app.calls.filter(call => call.action === 'progress').length, 2);
  assert.equal(app.element('resumeVideo').hidden, true);
});

test('logout ignores a late completion and clears the recovery reference', async () => {
  const storage = new Map(); let complete;
  const app = dashboard({ progress: () => new Promise(resolve => { complete = resolve; }) }, storage);
  await app.open(); await app.select(0, false);
  app.setSession(false);
  complete({ ...preview(stock[0].id), jobId }); await flush();
  assert.equal(app.element('vehiclePreview').hidden, true);
  assert.equal(app.element('resumeVideo').hidden, true);
  assert.equal(storage.size, 0);
});

test('returning to the page during a slow progress request never starts a parallel request', async () => {
  let complete;
  const app = dashboard({ progress: () => new Promise(resolve => { complete = resolve; }) });
  await app.open(); await app.select(0, false);
  app.visibility(true); app.visibility(false); await app.tick();
  assert.equal(app.calls.filter(call => call.action === 'progress').length, 1);
  complete({ ok: true, id: stock[0].id, jobId, status: 'preparing' }); await flush();
  await app.tick();
  assert.equal(app.calls.filter(call => call.action === 'progress').length, 2);
  complete({ ...preview(stock[0].id), jobId }); await flush();
  assert.equal(app.element('vehiclePreview').hidden, false);
  assert.equal(app.timers.size, 0);
});
