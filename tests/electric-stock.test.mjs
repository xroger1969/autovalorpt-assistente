import assert from 'node:assert/strict';
import test from 'node:test';
import stock from '../api/stock.js';
import { STOCK_INVENTORIES } from '../lib/stock-inventories.js';

const advert = (id, code = 'electric', label = 'Elétrico') => ({
  title: 'Modelo Electric', url: `https://www.standvirtual.com/carros/anuncio/modelo-${id}.html`,
  photos: [`https://ireland.apollo.olxcdn.com/v1/files/${id}/image;s=400x0`],
  price: { grossMinorAmount: 1829950, currencyCode: 'EUR' },
  attributes: [{ key: 'make', valueLabel: 'Marca' }, { key: 'mileage', value: '9010' },
    { key: 'first_registration_year', value: '2022' }, { key: 'fuel_type', value: code, valueLabel: label },
    { key: 'registration_number', value: 'AA-10-AA' }, { key: 'new_used', value: 'used' }],
});

async function call(method = 'GET', integration = 'electric-stock') {
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await stock({ method, query: { integration } }, res);
  return res;
}

test('public electric stock serves only available verified BEVs, sharing complete source reads without stale sales', async t => {
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
  const first = advert('ID8Qalpha'); const second = advert('ID8Qbravo', 'electric', ' ELÉCTRICO ');
  let lots = [[first, advert('ID8Qplug1', 'plugin-hybrid', 'Híbrido Plug-In'), advert('ID8Qplug2', 'plugin-hybrid', 'Elétrico')],
    [first, second, advert('ID8Qplug3', 'electric', 'Elétrico / Gasolina'), advert('ID8Qpetro', 'gasoline', 'Gasolina')]];
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const index = STOCK_INVENTORIES.findIndex(source => source.url === url);
    assert.notEqual(index, -1); assert.equal(options.method, 'GET'); seen.push(index);
    const ads = lots[index];
    if (!ads) return new Response('Unavailable', { status: 503 });
    const pageProps = { numberOfActiveAdverts: ads.length, urqlState: { a: { data: { publishedAds: { total: ads.length, ads } } } } };
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps } })}</script>`, { headers: { 'content-type': 'text/html' } });
  });

  const [a, b, all] = await Promise.all([call(), call(), call('GET', '')]);
  assert.deepEqual(seen.sort(), [0, 1]); assert.equal(all.body.results.length, 6);
  assert.equal(a.code, 200); assert.equal(a.body.checkedAt, new Date(clock).toISOString());
  assert.match(a.headers['Cache-Control'], /s-maxage=60/); assert.deepEqual(a.body, b.body);
  assert.deepEqual(a.body.items.map(x => x.id), ['ID8Qalpha', 'ID8Qbravo']);
  assert.deepEqual(a.body.items[0], { id: 'ID8Qalpha', title: first.title, brand: 'Marca', year: 2022, mileage: 9010,
    price: 18299.5, fuel: 'Elétrico', image: 'https://ireland.apollo.olxcdn.com/v1/files/ID8Qalpha/image;s=960x0',
    url: first.url, sources: ['Samucar', 'AutoValorPT'] });

  clock += 61000; lots = [[first], null];
  const outage = await call(); assert.equal(outage.code, 503); assert.equal(outage.headers['Cache-Control'], 'no-store');
  assert.equal(outage.body.error, 'electric_stock_unavailable'); assert.equal(outage.body.items, undefined);
  lots = [[], [second]];
  assert.deepEqual((await call()).body.items.map(x => x.id), ['ID8Qbravo']);
  clock += 61000; lots = [[], []];
  assert.deepEqual((await call()).body.items, []); const reads = seen.length;
  assert.deepEqual((await call()).body.items, []); assert.equal(seen.length, reads);
  assert.equal((await call('POST')).code, 405); assert.equal(seen.length, reads);
});
