import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = (await Promise.all(['editorial-preview.js', 'routine-calendar.js'].map(file =>
  readFile(new URL('../' + file, import.meta.url), 'utf8')))).join('\n');
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.textContent = ''; }
  get firstChild() { return this.children[0] || null; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
  pause() { this.paused = true; }
}
function plans() {
  return { ok: true, enabled: true, timezone: 'Europe/Lisbon', blocked: false, items: Array.from({ length: 7 }, (_, i) => {
    const date = '2027-07-0' + (i + 1);
    return { id: 'day' + i, date, scheduledAt: date + 'T18:00:00Z', status: 'scheduled', provisional: i === 0,
      title: 'Publicação ' + i, topic: 'Mobilidade', format: i === 1 ? 'REELS' : 'CAROUSEL', slideCount: 2,
      caption: 'Legenda ' + i, videoUrl: '/assets/editorial/test-drive-web-v1.mp4',
      images: [1, 2].map(slide => '/api/stock?integration=editorial-image&date=' + date + '&slide=' + slide + '&v=v2') };
  }) };
}
function dashboard(respond = () => Promise.resolve({ ok: true, json: async () => plans() })) {
  const panel = new Element('details'), list = new Element('div'), msg = new Element('p'), refresh = new Element('button');
  const controls = { routineCalendar: panel, calendarItems: list, calendarStatus: msg, calendarRefresh: refresh };
  const document = new Element('document'); document.getElementById = id => controls[id]; document.createElement = tag => new Element(tag);
  const calls = [];
  const context = vm.createContext({ document, URL, URLSearchParams, Date, Intl, setTimeout, clearTimeout, AbortController,
    fetch: (url, init) => { calls.push({ url, init }); return respond(); } });
  vm.runInContext(script, context);
  const api = context.AutoValorRoutineCalendar;
  function toggle(target, open) { target.open = open; target.handlers.toggle(); }
  return { api, panel, list, msg, refresh, calls, toggle };
}
test('calendar and individual previews load on demand with local dates, carousel and approved Reel', async () => {
  const app = dashboard(); app.toggle(app.panel, true); await tick(); assert.equal(app.calls.length, 0);
  app.api.setSession(true); assert.equal(app.calls.length, 0);
  app.toggle(app.panel, true); await tick();
  assert.equal(app.calls.length, 1); assert.equal(app.calls[0].url, '/api/stock?integration=editorial&action=calendar');
  assert.equal(app.calls[0].init.method, undefined); assert.equal(app.list.children.length, 7);
  assert.equal(app.list.querySelectorAll('img').length + app.list.querySelectorAll('video').length, 0);
  const [day, reel] = app.list.children;
  assert.match(day.children[0].children[0].textContent, /19:00/);
  assert.match(day.children[0].children[2].textContent, /Mobilidade.*Provisório/);
  app.toggle(day, true);
  assert.match(day.querySelector('img').src, /slide=1&v=v2$/);
  day.querySelectorAll('button')[1].handlers.click();
  assert.match(day.querySelector('img').src, /slide=2&v=v2$/);
  app.toggle(reel, true); assert.equal(reel.querySelector('video').src, '/assets/editorial/test-drive-web-v1.mp4');
  app.toggle(app.panel, false); assert.equal(reel.querySelector('video').paused, true);
  app.toggle(app.panel, true); await tick(); assert.equal(app.calls.length, 1);
  app.api.setSession(false); assert.equal(app.list.children.length, 0); assert.equal(app.panel.open, false);
});

test('calendar ignores superseded responses and refreshes an open panel on invalidation only', async () => {
  const pending = []; const app = dashboard(() => new Promise(resolve => pending.push(resolve)));
  app.api.setSession(true); app.api.invalidate(); assert.equal(app.calls.length, 0);
  app.toggle(app.panel, true); app.toggle(app.panel, false); assert.equal(app.calls[0].init.signal.aborted, true);
  app.toggle(app.panel, true); assert.equal(app.calls.length, 2);
  pending[0]({ ok: true, json: async () => plans() }); await tick();
  assert.equal(app.list.children.length, 0);
  pending[1]({ ok: true, json: async () => plans() }); await tick();
  assert.equal(app.list.children.length, 7);
  app.api.invalidate(); assert.equal(app.list.children.length, 0); assert.equal(app.calls.length, 3);
  app.api.setSession(false); pending[2]({ ok: true, json: async () => plans() }); await tick();
  assert.equal(app.list.children.length, 0);
});

test('errors, paused schedule and private session expiry are explicit and no unsafe media loads', async () => {
  const data = plans(); data.enabled = false; data.blocked = true; data.items[1].videoUrl = 'https://invalid.pt/assets/editorial/test-drive-web-v1.mp4';
  let status = 503, expired = false;
  const app = dashboard(() => Promise.resolve({ ok: status === 200, status, json: async () => data }));
  app.api.setSession(true, () => { expired = true; }); app.toggle(app.panel, true); await tick();
  assert.match(app.msg.textContent, /Não foi possível/); assert.equal(app.list.children.length, 0);
  status = 200; app.refresh.handlers.click(); await tick();
  assert.match(app.msg.textContent, /pausada.*publicação por confirmar/);
  app.toggle(app.list.children[1], true);
  assert.equal(app.list.children[1].querySelector('video'), undefined);
  status = 401; app.api.invalidate(); await tick();
  assert.equal(expired, true); assert.equal(app.list.children.length, 0); assert.equal(app.panel.open, false);
});

test('prepared caption and sources merge by date and ID without re-reading, replacing media or moving slides', async () => {
  const calendar = plans(), item = calendar.items[0];
  const prepared = { id: item.id, date: item.date, caption: 'Texto final', copyOrigin: 'editorial', sources: [{ label: 'ACP', url: 'https://www.acp.pt/noticia' }],
    title: 'Outro título', status: 'failed', scheduledAt: '2000-01-01T00:00:00Z', images: ['/different'], format: 'REELS' };
  for (const first of ['calendar', 'status']) {
    const app = dashboard(); app.api.setSession(true);
    if (first === 'status') app.api.setNextPost(prepared);
    app.toggle(app.panel, true); await tick(); const day = app.list.children[0];
    app.toggle(day, true); const img = day.querySelector('img'); day.querySelectorAll('button')[1].handlers.click();
    if (first === 'calendar') app.api.setNextPost(prepared);
    assert.equal(app.list.children[0], day); assert.equal(day.open, true);
    assert.match(day.children[0].children[0].textContent, /19:00/); assert.equal(day.children[0].children[1].textContent, item.title);
    assert.doesNotMatch(day.children[0].children[2].textContent, /Provisório|falhada/);
    assert.ok(day.querySelectorAll('p').some(p => p.textContent === prepared.caption));
    assert.equal(day.querySelector('a').href, prepared.sources[0].url);
    assert.ok(day.querySelectorAll('p').some(p => p.textContent === 'Legenda da redação AutoValorPT.'));
    assert.equal(day.querySelector('img'), img); assert.match(img.src, /slide=2&v=v2$/); assert.equal(app.calls.length, 1);

    for (const mismatch of [{ ...prepared, date: '2027-07-06' }, { ...prepared, id: 'other' }, { ...prepared, provisional: true }]) {
      app.api.setNextPost(mismatch);
      assert.match(day.children[0].children[2].textContent, /Provisório/);
      assert.ok(day.querySelectorAll('p').some(p => p.textContent === item.caption));
      assert.equal(day.querySelector('a'), undefined);
      assert.ok(!day.querySelectorAll('p').some(p => p.textContent === 'Legenda da redação AutoValorPT.'));
    }
    app.api.setNextPost({ ...prepared, id: calendar.items[1].id, date: calendar.items[1].date });
    app.toggle(app.list.children[1], true);
    assert.ok(app.list.children[1].querySelectorAll('p').some(p => p.textContent === calendar.items[1].caption));
    app.api.setNextPost(prepared); app.api.setSession(false); app.api.setSession(true);
    app.toggle(app.panel, true); await tick();
    assert.match(app.list.children[0].children[0].children[2].textContent, /Provisório/);
  }
});
