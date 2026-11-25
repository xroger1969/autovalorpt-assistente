import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../eletricos.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../eletricos.html', import.meta.url), 'utf8');
const checkedAt = '2026-11-25T12:34:00Z';
const car = (id, title, price, source) => ({
  id, title, price, brand: title.split(' ')[0], year: 2021, fuel: 'Elétrico', mileage: 42000, sources: [source],
  url: `https://www.standvirtual.com/carros/anuncio/viatura-${id}.html`,
  image: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;s=720x0`,
});
const wait = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.events = {}; }
  setAttribute(name, value) { this[name] = value; }
  append(...values) { this.children.push(...values); }
  replaceChildren(...values) { this.children = [...values]; }
  addEventListener(name, fn) { this.events[name] = fn; }
  all(tag) { return this.children.flatMap(el => el.tagName === tag ? [el] : el.all(tag)); }
}

function page(responses) {
  const ids = new Map(), calls = [];
  const el = id => {
    if (!ids.has(id)) ids.set(id, new Element('div'));
    return ids.get(id);
  };
  const window = new Element('window');
  vm.runInNewContext(script, { document: { getElementById: el, createElement: tag => new Element(tag) }, window,
    AbortController, URL, setTimeout, clearTimeout, fetch: async (url, init) => {
      calls.push({ url, init });
      const result = await responses.shift();
      return { ok: result.ok, json: async () => result };
    } });
  return { el, calls, window };
}

test('public stock page links to the comparator and uses only confirmed listings, original photos and factual prices', async () => {
  assert.match(html, /href="https:\/\/carregador\.vercel\.app\/"/);
  assert.doesNotMatch(html, /<li\b|\/api\/admin/);
  const a = car('ID8stock1', 'Renault Zoe', 12990, 'AutoValorPT'), b = car('ID8stock2', 'Tesla Model 3', 21999.5, 'Samucar');
  const app = page([{ ok: true, checkedAt, items: [b, a] }]);
  await wait();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, '/api/stock?integration=electric-stock');
  assert.equal(app.calls[0].init.method, 'GET');
  assert.equal(app.calls[0].init.credentials, 'omit');
  const items = app.el('vehicleList').children;
  assert.deepEqual(items.map(i => i.all('h2')[0].textContent), [a.title, b.title]);
  assert.deepEqual(items.map(i => i.all('a')[0].href), [a.url, b.url]);
  assert.deepEqual(items.map(i => i.all('img')[0].src), [a.image, b.image]);
  const price = items[0].all('p').find(p => p.className === 'stock-price'); assert.match(price.textContent.replace(/\s/g, ''), /12990€/);
  assert.equal(app.el('inventoryStatus').textContent, '2 viaturas disponíveis');
  assert.equal(app.el('checkedAt').dateTime, new Date(checkedAt).toISOString());
  const frame = items[0].children[0]; frame.children[0].events.error();
  assert.equal(frame.children[0].textContent, 'Fotografia indisponível');
  assert.equal(items[0].all('a')[0].href, a.url);
});

test('refresh from the back-forward cache clears stale listings, distinguishes unavailable and empty, and supports retry', async () => {
  const item = car('ID8stock1', 'Renault Zoe', 12990, 'AutoValorPT');
  let release; const pending = new Promise(resolve => { release = resolve; });
  const app = page([{ ok: true, checkedAt, items: [item] }, pending, { ok: true, checkedAt, items: [] }]);
  await wait();
  app.window.events.pageshow({ persisted: true });
  assert.equal(app.el('vehicleList').children.length, 0);
  assert.match(app.el('inventoryStatus').textContent, /consultar/);
  app.el('retryInventory').events.click();
  assert.equal(app.calls.length, 2);
  release({ ok: false }); await wait();
  assert.equal(app.el('checkedAt').hidden, true);
  assert.match(app.el('inventoryStatus').textContent, /confirmar/);
  assert.equal(app.el('retryInventory').hidden, false);
  await app.el('retryInventory').events.click();
  assert.match(app.el('inventoryStatus').textContent, /não há elétricos/);
  assert.equal(app.el('checkedAt').hidden, false);
  assert.equal(app.el('vehicleList')['aria-busy'], 'false');
});

test('an invalid destination or unconfirmed data never appear as listings or as an empty inventory', async () => {
  const good = car('ID8stock1', 'Renault Zoe', 12990, 'AutoValorPT');
  for (const changed of [{ url: 'https://example.invalid/anuncio' }, { image: 'https://example.invalid/photo.jpg' }, { price: null }]) {
    const app = page([{ ok: true, checkedAt, items: [good, { ...good, ...changed }] }]);
    await wait();
    assert.equal(app.el('vehicleList').children.length, 0);
    assert.match(app.el('inventoryStatus').textContent, /confirmar/);
    assert.equal(app.el('retryInventory').hidden, false);
  }
});
