import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../editorial.js', import.meta.url), 'utf8');
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));
const ready = () => ({
  ok: true, enabled: true,
  configuration: { production: true, tokenConfigured: true, accountConfigured: true, validApi: true, imagesConfigured: true },
  authorization: { expired: false }, schedule: { nextRunAt: '2026-11-21T19:00:00Z' },
  nextPost: { date: '2026-11-21', title: 'Um carro para a tua rotina', format: 'CAROUSEL', slideCount: 3,
    caption: 'Uma legenda original.', images: ['/api/stock?integration=editorial-image&date=2026-11-21&slide=1&version=v1'] },
  history: [], active: null, lastResult: null
});

async function dashboard(options = {}) {
  const elements = new Map(); const calls = []; let tick;
  const element = () => ({ textContent: '', className: '', children: [], hidden: false, disabled: false, value: '', handlers: {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    removeAttribute(name) { delete this[name]; }, getAttribute(name) { return this[name] || null; }
  });
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const fetch = async (endpoint, init = {}) => {
    calls.push({ endpoint, init });
    if (options.fetch) { const result = await options.fetch(endpoint, init); if (result) return result; }
    if (endpoint === '/api/admin-session') return response({ authenticated: options.authenticated !== false, configured: true });
    return response(options.status || ready());
  };
  vm.runInNewContext(script, { document, fetch, URL, URLSearchParams, Date, Intl, AbortController,
    setTimeout, clearTimeout, setInterval: callback => { tick = callback; }, navigator: { clipboard: { writeText: async () => {} } } });
  await flush();
  return { get: id => document.getElementById(id), calls, document, tick: () => tick() };
}

test('editorial dashboard reads private status only after authentication and never starts a publication', async () => {
  const app = await dashboard({ authenticated: false });
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('loginView').hidden, false);
  app.tick(); await flush();
  assert.deepEqual(app.calls.map(call => call.endpoint), ['/api/admin-session']);
  const signedIn = await dashboard();
  assert.equal(signedIn.calls.length, 2);
  assert.ok(signedIn.calls.every(call => !call.init.method));
  assert.doesNotMatch(script, /action=run|localStorage|sessionStorage|innerHTML/);
});

test('enabled and configured is distinct from confirmed publication', async () => {
  const app = await dashboard();
  assert.equal(app.get('routineBadge').textContent, 'Rotina ativa');
  assert.equal(app.get('resultBadge').textContent, 'Ainda sem execução');
  assert.match(app.get('connectionStatus').textContent, /configurada.*será confirmada/);
  assert.equal(app.get('lastPostLink').hidden, true);
  assert.match(app.get('previewImage').src, /^\/api\/stock\?integration=editorial-image&date=2026-11-21&slide=1&version=v1$/);
  assert.equal(app.get('previousSlide').disabled, true);
  app.get('nextSlide').handlers.click();
  assert.match(app.get('previewImage').src, /slide=2/);
  assert.equal(app.get('slidePosition').textContent, '2 / 3');
});

test('expired session clears private captions, image, links and history', async () => {
  let expired = false;
  const data = ready(); data.lastResult = { status: 'published', permalink: 'https://www.instagram.com/p/ABC123/', at: '2026-11-21T19:10:00Z' };
  const app = await dashboard({ status: data, fetch: endpoint => expired && endpoint.includes('action=status') ? response({ error: 'private_access_required' }, 401) : null });
  assert.equal(app.get('captionText').textContent, 'Uma legenda original.');
  assert.equal(app.get('lastPostLink').hidden, false);
  expired = true; app.tick(); await flush();
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('captionText').textContent, '');
  assert.equal(app.get('previewImage').src, undefined);
  assert.equal(app.get('lastPostLink').href, undefined);
  assert.deepEqual(app.get('historyList').children, []);
  assert.match(app.get('loginStatus').textContent, /sessão terminou/);
});

test('unknown active attempt overrides an old success and never offers an unconfirmed link', async () => {
  const data = ready(); data.active = { phase: 'publish_unknown', startedAt: '2026-11-21T19:00:00Z' };
  data.lastResult = { status: 'published', permalink: 'https://www.instagram.com/p/ABC123/' };
  const app = await dashboard({ status: data });
  assert.equal(app.get('resultBadge').textContent, 'Publicação por confirmar');
  assert.equal(app.get('lastPostLink').hidden, true);
  assert.match(app.get('resultDescription').textContent, /evita repetir/);
});

test('failed pause response does not report success and requires a fresh status before retry', async () => {
  const app = await dashboard({ fetch: endpoint => endpoint.includes('action=settings') ? response({ error: 'unavailable' }, 503) : null });
  await app.get('toggleButton').handlers.click();
  const mutation = app.calls.find(call => call.endpoint.includes('action=settings'));
  assert.equal(mutation.init.method, 'POST');
  assert.equal(mutation.init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(mutation.init.body), { enabled: false });
  assert.equal(app.get('routineBadge').textContent, 'Estado por confirmar');
  assert.equal(app.get('toggleButton').disabled, true);
  assert.match(app.get('dashboardStatus').textContent, /Não foi possível confirmar a alteração/);
  assert.equal(app.get('previewImage').src, undefined);
});

test('pause uses confirmed server state and refresh does not repeat mutations', async () => {
  const paused = { ...ready(), enabled: false };
  const app = await dashboard({ fetch: endpoint => endpoint.includes('action=settings') ? response(paused) : null });
  await app.get('toggleButton').handlers.click();
  assert.equal(app.get('routineBadge').textContent, 'Rotina pausada');
  assert.equal(app.get('nextRun').textContent, 'Rotina pausada');
  assert.equal(app.get('toggleButton').textContent, 'Ativar publicações');
  app.tick(); await flush();
  assert.equal(app.calls.filter(call => call.init.method === 'POST').length, 1);
});

test('unknown errors and malicious links are not rendered as provider content or outgoing URLs', async () => {
  const data = ready();
  data.authorization.lastError = 'PRIVATE PROVIDER RESPONSE';
  data.nextPost.images = ['https://attacker.invalid/image.jpg?version=safe_v1'];
  data.history = [
    { date: '2026-11-21', title: '<img src=x onerror=alert(1)>', status: 'published', permalink: 'https://www.instagram.com.attacker.invalid/p/ABC123/' },
    { date: '2026-11-20', title: 'Conteúdo anterior', status: 'publish_unknown', permalink: 'https://www.instagram.com/p/ABC123/' },
    { date: '2026-11-19', title: 'Conteúdo confirmado', status: 'published', permalink: 'https://www.instagram.com/autovalorpt/reel/Good123/?tracking=1' }
  ];
  const app = await dashboard({ status: data });
  assert.doesNotMatch(app.get('connectionStatus').textContent, /PRIVATE/);
  assert.match(app.get('connectionStatus').textContent, /precisa de verificação/);
  assert.match(app.get('previewImage').src, /^\/api\/stock\?/);
  const rows = app.get('historyList').children;
  assert.equal(rows[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(rows[0].children[2].children.length, 1);
  assert.equal(rows[1].children[2].children.length, 1);
  assert.equal(rows[2].children[2].children[1].href, 'https://www.instagram.com/autovalorpt/reel/Good123/');
});

test('hidden dashboard does not poll and unavailable reads clear previously shown future content', async () => {
  let failed = false;
  const app = await dashboard({ fetch: endpoint => failed && endpoint.includes('action=status') ? response({ error: 'state_unavailable' }, 503) : null });
  const before = app.calls.length; app.document.hidden = true; app.tick(); await flush();
  assert.equal(app.calls.length, before);
  app.document.hidden = false; failed = true; app.tick(); await flush();
  assert.equal(app.get('routineBadge').textContent, 'Estado por confirmar');
  assert.equal(app.get('previewContent').hidden, true);
  assert.equal(app.get('captionText').textContent, '');
});

test('approved authored Reel has inline controls, a cover and the correct format without image navigation', async () => {
  const data = ready(); data.nextPost.format = 'REELS'; data.nextPost.videoUrl = '/assets/editorial/rotina-web-v1.mp4';
  const app = await dashboard({ status: data });
  assert.equal(app.get('formatBadge').textContent, 'Reel');
  assert.equal(app.get('previewVideo').src, '/assets/editorial/rotina-web-v1.mp4');
  assert.match(app.get('previewVideo').poster, /^\/api\/stock\?integration=editorial-image/);
  assert.equal(app.get('videoFrame').hidden, false);
  assert.equal(app.get('imageFrame').hidden, true);
  assert.equal(app.get('slideControls').hidden, true);
  const html = await readFile(new URL('../editorial.html', import.meta.url), 'utf8');
  assert.match(html, /id="previewVideo" controls playsinline preload="metadata"/);
  assert.doesNotMatch(html, /autoplay/);
});

test('external or unexpected video sources never load even when their filenames appear approved', async () => {
  for (const source of ['https://attacker.invalid/assets/editorial/rotina-web-v1.mp4', '/assets/editorial/unapproved.mp4', '//attacker.invalid/assets/editorial/test-drive-web-v1.mp4', '/assets/editorial/rotina-web-v1.mp4?redirect=elsewhere']) {
    const data = ready(); data.nextPost.format = 'REELS'; data.nextPost.videoUrl = source;
    const app = await dashboard({ status: data });
    assert.equal(app.get('videoFrame').hidden, true);
    assert.equal(app.get('previewVideo').src, undefined);
    assert.match(app.get('imageStatus').textContent, /ainda não está disponível/);
    assert.equal(app.get('captionText').textContent, 'Uma legenda original.');
  }
});

test('a session expiry stops and clears a prepared Reel', async () => {
  let expired = false; const data = ready(); data.nextPost.format = 'REELS'; data.nextPost.videoUrl = 'https://autovalorpt-assistente.vercel.app/assets/editorial/test-drive-web-v1.mp4';
  const app = await dashboard({ status: data, fetch: endpoint => expired && endpoint.includes('action=status') ? response({}, 401) : null });
  assert.equal(app.get('previewVideo').src, '/assets/editorial/test-drive-web-v1.mp4');
  expired = true; app.tick(); await flush();
  assert.equal(app.get('previewVideo').src, undefined);
  assert.equal(app.get('previewVideo').poster, undefined);
  assert.equal(app.get('videoFrame').hidden, true);
});

test('confirmed publication keeps an unconfirmed AI indication visible', async () => {
  const data = ready(); data.lastResult = { status: 'published', reason: 'ai_label_unconfirmed', permalink: 'https://www.instagram.com/p/AI123/' };
  const app = await dashboard({ status: data });
  assert.equal(app.get('resultBadge').textContent, 'Publicação confirmada');
  assert.equal(app.get('lastPostLink').hidden, false);
  assert.match(app.get('resultDescription').textContent, /IA ainda precisa de confirmação/);
});
