import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../app/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://autovalorpt-assistente.vercel.app';
const indexHTML = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const BUILD = indexHTML.match(/name="autovalor-app-build" content="([^"]+)"/)?.[1];
assert.ok(BUILD, 'the published shell must identify its release');
const CACHE = `autovalor-catalogue-v1-${BUILD}`;
const shellHTML = build => `<!doctype html><meta name="autovalor-app-build" content="${build}"><main>Catálogo</main>`;

function responseFor(url) {
  const path = new URL(url).pathname;
  if (path.endsWith('.html') || path === '/app/') {
    return new Response(shellHTML(BUILD), { headers: { 'Content-Type': 'text/html' } });
  }
  const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript'
    : path.endsWith('.png') ? 'image/png' : 'application/manifest+json';
  return new Response('shell', { headers: { 'Content-Type': type } });
}

function runtime() {
  const listeners = new Map();
  const cacheStores = new Map();
  const requests = [];
  const key = input => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
  let fetchImpl = request => responseFor(request.url);
  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new Map());
      const entries = cacheStores.get(name);
      return {
        async match(input) { return entries.get(key(input))?.clone(); },
        async put(input, response) { entries.set(key(input), response.clone()); },
      };
    },
    async keys() { return [...cacheStores.keys()]; },
    async delete(name) { return cacheStores.delete(name); },
  };
  let claimed = false;
  vm.runInNewContext(source, {
    self: {
      location: { origin: ORIGIN },
      addEventListener(type, listener) { listeners.set(type, listener); },
      clients: { async claim() { claimed = true; } },
    },
    caches, URL, Request, Response, AbortController, setTimeout, clearTimeout,
    async fetch(request) { requests.push(request); return fetchImpl(request); },
  });
  return {
    caches, requests, cacheStores,
    get claimed() { return claimed; },
    fetchWith(fn) { fetchImpl = fn; },
    async lifecycle(type) {
      let work;
      listeners.get(type)({ waitUntil(promise) { work = promise; } });
      await work;
    },
    dispatch(url, { navigate = false, method = 'GET' } = {}) {
      const request = new Request(new URL(url, ORIGIN), { method });
      if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
      let result;
      listeners.get('fetch')({ request, respondWith(value) { result = Promise.resolve(value); } });
      return result;
    },
  };
}

test('manifest installs the public catalogue with a separate identity, scope and PNG icons', async () => {
  const manifest = JSON.parse(await readFile(new URL('../app/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.id, '/app/index.html');
  assert.equal(manifest.start_url, '/app/index.html');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'pt-PT');
  for (const [path, width] of [
    ['app-192.png', 192], ['app-512.png', 512], ['apple-touch-icon.png', 180],
  ]) {
    const png = await readFile(new URL(`../app/icons/${path}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), width);
  }
});

test('catalogue worker never intercepts private routes, API calls, external photos or unknown files', () => {
  const worker = runtime();
  for (const url of [
    '/api/stock?integration=catalogue-app', '/api/stock?integration=morning-flow&action=start',
    '/stock-rapido.html', '/catalogo.html', '/OneSignalSDKWorker.js', '/app/private.json',
    'https://ireland.apollo.olxcdn.com/v1/files/photo/image', 'https://wa.me/351965637736',
  ]) {
    assert.equal(worker.dispatch(url), undefined, url);
    assert.equal(worker.dispatch(url, { navigate: true }), undefined, url);
  }
  assert.equal(worker.dispatch(`/app/catalogue.js?v=${BUILD}`, { method: 'POST' }), undefined);
  assert.equal(worker.dispatch('/app/index.html?admin=1', { navigate: true }), undefined);
  assert.equal(worker.requests.length, 0);
});

test('offline navigation keeps a vehicle link while serving one complete version of the shell', async () => {
  const worker = runtime();
  await worker.lifecycle('install');
  assert.equal(worker.cacheStores.get(CACHE).size, 8);
  assert.ok(worker.requests.every(request => request.credentials === 'omit' && request.redirect === 'error'));
  worker.fetchWith(() => { throw new Error('offline'); });
  const page = await worker.dispatch('/app/index.html?viatura=ID8Q1pLS', { navigate: true });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Catálogo/);
  const count = worker.requests.length;
  const script = await worker.dispatch(`/app/catalogue.js?v=${BUILD}`);
  assert.equal(await script.text(), 'shell');
  assert.equal(worker.requests.length, count, 'matching script is served from the same shell cache');
});

test('login or error pages cannot overwrite the offline shell', async () => {
  const worker = runtime();
  await worker.lifecycle('install');
  for (const reply of [
    new Response('<form>Sign in</form>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('private session', { status: 401, headers: { 'Content-Type': 'text/html' } }),
    new Response('unavailable', { status: 503 }),
  ]) {
    worker.fetchWith(() => reply.clone());
    const page = await worker.dispatch('/app/index.html', { navigate: true });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Catálogo/);
  }
  const cached = await (await worker.caches.open(CACHE)).match('/app/index.html');
  assert.equal(await cached.text(), shellHTML(BUILD));
});

test('a future live build does not mix into the existing offline cache', async () => {
  const worker = runtime();
  await worker.lifecycle('install');
  const nextHTML = shellHTML('20261127-1');
  worker.fetchWith(() => new Response(nextHTML, { headers: { 'Content-Type': 'text/html' } }));
  const live = await worker.dispatch('/app/index.html', { navigate: true });
  assert.equal(await live.text(), nextHTML);
  const cached = await (await worker.caches.open(CACHE)).match('/app/index.html');
  assert.equal(await cached.text(), shellHTML(BUILD));
  assert.equal(worker.dispatch('/app/catalogue.js?v=20261127-1'), undefined,
    'new versioned assets pass directly to the network');
});

test('activation removes only previous catalogue caches and leaves notification caches intact', async () => {
  const worker = runtime();
  await worker.lifecycle('install');
  await worker.caches.open('autovalor-catalogue-v1-previous');
  await worker.caches.open('OneSignal-cache');
  await worker.caches.open('other-app');
  await worker.lifecycle('activate');
  assert.deepEqual((await worker.caches.keys()).sort(), [CACHE, 'OneSignal-cache', 'other-app'].sort());
  assert.equal(worker.claimed, true);
});

test('an incomplete or redirected shell cannot finish installation', async () => {
  for (const failure of ['http', 'redirect']) {
    const worker = runtime();
    worker.fetchWith(request => {
      if (!request.url.includes('/catalogue-core.js')) return responseFor(request.url);
      const response = new Response('login', {
        status: failure === 'http' ? 503 : 200,
        headers: { 'Content-Type': 'text/javascript' },
      });
      if (failure === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });
    await assert.rejects(worker.lifecycle('install'), /catalogue_shell_unavailable/);
    assert.equal((await worker.caches.keys()).includes(CACHE), false);
  }
});
