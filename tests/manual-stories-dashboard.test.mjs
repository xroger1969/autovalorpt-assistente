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
  pause() {}
  load() { this.readyState = 0; }
}

function dashboard(overrides = {}, storage = new Map()) {
  const elements = new Map(); const calls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  }
  const handlers = { stock: () => ({ ok: true, items: stock }), preview: ({ id }) => preview(id),
    publish: ({ id }) => ({ id, status: 'published' }), ...overrides };
  const context = { document: { getElementById: element, createElement: () => new Element() },
    fetch: async (url, options) => {
      const action = new URL(url, 'https://example.test').searchParams.get('action').replace('stories-manual-', '');
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ action, body }); const result = await handlers[action](body);
      return { ok: true, status: 200, json: async () => result };
    }, location: { origin: 'https://example.test' }, URL, AbortController, clearTimeout, setTimeout,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
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
  return { element, click, open, select, calls, results };
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
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'preview']);
  app.click('publishStory'); app.click('sendStory'); app.click('sendStory'); await flush();
  assert.deepEqual(app.calls.filter(call => call.action === 'publish').map(call => call.body), [
    { id: stock[1].id, fingerprint, reviewToken: 'review-' + stock[1].id, confirmed: true }
  ]);
  assert.equal(app.element('publishStory').disabled, true);
});

test('a lost publication response survives reload and only queries the original receipt', async () => {
  const storage = new Map();
  const first = dashboard({ publish() { throw new Error('disconnected'); } }, storage);
  await first.open(); await first.select(0);
  first.click('publishStory'); first.click('sendStory'); await flush();
  assert.equal(first.element('publishStory').disabled, true); assert.equal(storage.size, 1);
  const next = dashboard({ status: input => ({ id: input.id, status: 'published' }) }, storage);
  next.element('pendingStories').children[0].emit('click'); await flush();
  assert.deepEqual(next.calls, [{ action: 'status', body: { id: stock[0].id, fingerprint, reviewToken: 'review-' + stock[0].id } }]);
  assert.equal(storage.size, 0);
});

test('the confirmation stays closed before the video loads and after a playback error', async () => {
  const app = dashboard(); await app.open(); await app.select(0, false);
  const player = app.element('vehicleVideo');
  assert.ok(app.element('publishStory').disabled);
  app.click('publishStory'); assert.ok(!app.element('confirmStory').open);
  player.readyState = 1; player.emit('loadedmetadata'); assert.equal(app.element('publishStory').disabled, false);
  player.error = { code: 4 }; player.emit('error'); assert.equal(app.element('publishStory').disabled, true);
  app.click('publishStory'); assert.ok(!app.element('confirmStory').open);
  assert.deepEqual(app.calls.map(call => call.action), ['stock', 'preview']);
});
