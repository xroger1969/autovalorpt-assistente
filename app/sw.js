/* This worker belongs only to /app/. It must never cache the shared API,
   the private manager, WhatsApp links, or vehicle photographs. */
const BUILD = '20261126-3';
const PREFIX = 'autovalor-catalogue-v1-';
const CACHE = `${PREFIX}${BUILD}`;
const INDEX = '/app/index.html';
const ORIGIN = self.location.origin;
const SHELL = new Map([
  [INDEX, 'html'],
  [`/app/styles.css?v=${BUILD}`, 'css'],
  [`/app/catalogue.js?v=${BUILD}`, 'script'],
  [`/app/catalogue-core.js?v=${BUILD}`, 'script'],
  ['/app/manifest.webmanifest', 'manifest'],
  ['/app/icons/app-192.png', 'image'],
  ['/app/icons/app-512.png', 'image'],
  ['/app/icons/apple-touch-icon.png', 'image'],
]);

function pageBuild(html) {
  const tag = html.match(/<meta\b[^>]*\bname\s*=\s*["']autovalor-app-build["'][^>]*>/i)?.[0];
  return tag?.match(/\bcontent\s*=\s*["']([0-9]{8}-[0-9]+)["']/i)?.[1] || null;
}

async function acceptable(response, kind, currentBuild = true) {
  if (!response || response.status !== 200 || response.redirected ||
      ['opaque', 'opaqueredirect', 'error'].includes(response.type)) return false;
  if (response.url && new URL(response.url).origin !== ORIGIN) return false;
  const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (kind === 'html') {
    if (type !== 'text/html') return false;
    const version = pageBuild(await response.clone().text());
    return currentBuild ? version === BUILD : Boolean(version);
  }
  if (kind === 'css') return type === 'text/css';
  if (kind === 'script') return ['application/javascript', 'text/javascript'].includes(type);
  if (kind === 'manifest') return ['application/manifest+json', 'application/json'].includes(type);
  return kind === 'image' && type === 'image/png';
}

self.addEventListener('install', event => {
  // Populate a separate cache completely before the new worker can activate.
  // No skipWaiting: already open windows keep their current script/CSS pair.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await Promise.all([...SHELL].map(async ([path, kind]) => {
        const response = await fetch(new Request(new URL(path, ORIGIN), {
          cache: 'reload', credentials: 'omit', redirect: 'error',
        }));
        if (!await acceptable(response, kind)) throw new Error('catalogue_shell_unavailable');
        await cache.put(path, response);
      }));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function navigation(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(new Request(request, {
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
    }));
    if (!await acceptable(response, 'html', false)) throw new Error('catalogue_page_unavailable');
    // Only this build's HTML may become its offline fallback. A newer live
    // page uses its own versioned script/style URLs and is never mixed into
    // this cache. The browser will install the corresponding new worker.
    if (await acceptable(response, 'html')) {
      const cache = await caches.open(CACHE);
      await cache.put(INDEX, response.clone());
    }
    return response;
  } catch {
    const cached = await (await caches.open(CACHE)).match(INDEX);
    return cached || new Response('Sem ligação. Volte a abrir a AutoValorPT quando tiver internet.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function shellAsset(request, path, kind) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(path);
  if (cached) return cached;
  const response = await fetch(new Request(request, { credentials: 'omit', redirect: 'error' }));
  if (await acceptable(response, kind)) await cache.put(path, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== ORIGIN) return;
  // An explicit allowlist prevents accidental interception of /api/stock,
  // whose other integration modes include private administrative actions.
  if (event.request.mode === 'navigate') {
    if (![INDEX, '/app/'].includes(url.pathname)) return;
    if ([...url.searchParams.keys()].some(key => key !== 'viatura')) return;
    event.respondWith(navigation(event.request));
    return;
  }
  const path = `${url.pathname}${url.search}`;
  const kind = SHELL.get(path);
  if (!kind || kind === 'html') return;
  event.respondWith(shellAsset(event.request, path, kind));
});
