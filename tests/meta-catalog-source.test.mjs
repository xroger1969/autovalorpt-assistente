import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaCatalogSource, auditMetaCatalogSource, META_CATALOG_SOURCE_URLS as URLS } from '../lib/meta-catalog-source.js';

const columns = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
const checkedAt = '2026-11-14T11:35:00.000Z';
const car = (id, overrides = {}) => ({ id, title: 'Tesla Model 3 Performance | 2020 | 170 000 km',
  description: 'Tesla Model 3 Performance. Elétrico. Outubro de 2020. 170 000 km.', availability: 'in stock', condition: 'used',
  price: '26990.00 EUR', link: `https://www.standvirtual.com/carros/anuncio/tesla-model-3-${id}.html`,
  image_link: `https://ireland.apollo.olxcdn.com/v1/files/${id}/image;q=100;s=600x0`, brand: 'Tesla', ...overrides });
const advert = (item) => ({ title: 'Tesla Model 3 Performance', url: item.link,
  price: { currencyCode: 'EUR', grossMinorAmount: Math.round(Number(item.price.split(' ')[0]) * 100) },
  photos: [item.image_link.split(';')[0]], attributes: [
    { key: 'make', value: 'tesla', valueLabel: 'Tesla' }, { key: 'new_used', value: 'used' },
    { key: 'first_registration_year', value: '2020' }, { key: 'mileage', value: '170000' },
    { key: 'fuel_type', value: 'electric', valueLabel: 'Elétrico' },
  ] });
const csv = (items) => [columns, ...items.map((item) => columns.map((key) => item[key]))]
  .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
const html = (ads, options = {}) => `<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: {
  numberOfActiveAdverts: options.count ?? ads.length,
  urqlState: { inventory: { data: JSON.stringify({ publishedAds: { ...(options.omitTotal ? {} : { total: options.total ?? ads.length }), ads } }) } },
} } })}</script></html>`;

function fixture(options = {}) {
  const items = options.items || Array.from({ length: 9 }, (_, i) => car(`ID8stock0${i}`));
  const stock = options.stock || [...items, car('ID8sold01', { availability: 'out of stock' })];
  const ads = options.ads || items.map(advert); const calls = [];
  const bodies = { [URLS.inventory]: options.html ?? html(ads, options), [URLS.catalog]: options.catalogCsv ?? csv(items), [URLS.stock]: options.stockCsv ?? csv(stock) };
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, redirect: init.redirect, signal: init.signal });
    assert.equal(init.method, 'GET'); assert.ok(init.signal instanceof AbortSignal);
    const override = options.respond?.(url, init, calls);
    if (override) return override;
    assert.ok(Object.hasOwn(bodies, url), `Unexpected URL: ${url}`);
    return new Response(bodies[url], { headers: { 'content-type': url === URLS.inventory ? 'text/html; charset=utf-8' : 'text/csv; charset=utf-8' } });
  };
  return { calls, items, ads, stock, fetchImpl, source: createMetaCatalogSource({ fetchImpl, now: () => Date.parse(checkedAt), ...options.sourceOptions }) };
}

test('requires all nine current vehicles and matching CSV fields; preserves historical sold stock', async () => {
  const f = fixture(); const result = await f.source.audit();
  assert.equal(result.valid, true); assert.equal(result.expectedCount, 9); assert.equal(result.sourceCount, 9);
  assert.equal(result.checkedAt, checkedAt); assert.match(result.feedHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.items, f.items); assert.equal(result.items.some((item) => item.availability !== 'in stock'), false);
  assert.equal(f.calls.length, 3); assert.ok(f.calls.every((call) => call.method === 'GET'));
});

test('row order does not change the feed fingerprint', async () => {
  const f = fixture(); const first = await f.source.audit();
  const second = await fixture({ items: [...f.items].reverse() }).source.audit();
  assert.equal(second.valid, true); assert.equal(first.feedHash, second.feedHash);
});

test('six visible cards cannot satisfy an announced inventory of nine, even when both CSVs agree', async () => {
  const f = fixture({ items: Array.from({ length: 6 }, (_, i) => car(`ID8stock0${i}`)), count: 9, total: 9 });
  assert.equal((await f.source.audit()).reason, 'source_incomplete_inventory');
});

test('empty source, missing totals, missing NEXT_DATA and malformed JSON all fail closed', async () => {
  assert.equal((await fixture({ items: [] }).source.audit()).reason, 'source_empty_inventory');
  const f = fixture();
  for (const body of [html(f.ads, { omitTotal: true }), '<html>9 anúncios <h2>Tesla</h2></html>', '<script id="__NEXT_DATA__">{bad</script>']) {
    const result = await fixture({ html: body }).source.audit();
    assert.equal(result.valid, false); assert.equal('items' in result, false);
  }
});

test('duplicate advertised IDs and differing advertised totals never authorize replacement', async () => {
  const f = fixture();
  assert.equal((await fixture({ ads: [f.ads[0], f.ads[0], ...f.ads.slice(2)] }).source.audit()).reason, 'source_duplicate_vehicle');
  assert.equal((await fixture({ total: 10 }).source.audit()).reason, 'source_incomplete_inventory');
});

test('a drop greater than half is blocked despite internally consistent source and CSVs', async () => {
  const f = fixture({ items: Array.from({ length: 4 }, (_, i) => car(`ID8stock0${i}`)) });
  const result = await f.source.audit({ previousExpectedCount: 9 });
  assert.equal(result.reason, 'source_suspicious_drop'); assert.equal('items' in result, false);
  assert.equal((await f.source.audit({ lastExpectedCount: 8 })).valid, true);
  assert.equal((await f.source.audit({ previousExpectedIds: Array.from({ length: 9 }, (_, i) => `ID8stock0${i}`) })).reason, 'source_suspicious_drop');
  assert.equal((await f.source.audit({ previousExpectedCount: '9' })).reason, 'source_invalid_previous_count');
});

test('a source price change blocks the old price even when both CSVs still agree', async () => {
  const f = fixture(); f.ads[0].price.grossMinorAmount = 2799000;
  const result = await fixture({ ads: f.ads }).source.audit();
  assert.equal(result.reason, 'source_price_mismatch'); assert.equal('items' in result, false);
});

test('wrong vehicle set, stale mileage and wrong photo each block import', async () => {
  const f = fixture();
  assert.equal((await fixture({ ads: [advert(car('ID8other01')), ...f.ads.slice(1)] }).source.audit()).reason, 'source_ids_mismatch');
  const mileage = structuredClone(f.ads); mileage[0].attributes.find((attribute) => attribute.key === 'mileage').value = '175000';
  assert.equal((await fixture({ ads: mileage }).source.audit()).reason, 'source_item_mismatch');
  const photos = structuredClone(f.ads); photos[0].photos = [advert(car('ID8other01')).photos[0]];
  assert.equal((await fixture({ ads: photos }).source.audit()).reason, 'source_item_mismatch');
});

test('Catalogo must exactly equal all nine fields of the in-stock historical rows', async () => {
  const f = fixture(); const changed = f.stock.map((item, i) => i === 0 ? { ...item, description: 'Texto diferente' } : item);
  assert.equal((await fixture({ stock: changed }).source.audit()).reason, 'feeds_mismatch');
  const sold = [car('ID8sold01', { availability: 'out of stock' }), ...f.items];
  assert.equal((await fixture({ catalogCsv: csv(sold) }).source.audit()).reason, 'catalog_invalid_item');
});

test('empty description, empty brand and ID/link mismatches cannot enter the catalogue', async () => {
  const f = fixture();
  for (const override of [{ description: '' }, { brand: '' }, { link: car('ID8other01').link }]) {
    const items = f.items.map((item, i) => i === 0 ? { ...item, ...override } : item);
    assert.equal((await fixture({ items, ads: f.ads }).source.audit()).reason, 'catalog_invalid_item');
  }
});

test('existing strict CSV parser rejects truncation and oversized streams', async () => {
  const f = fixture();
  assert.equal((await fixture({ catalogCsv: csv(f.items) + '\n"unfinished' }).source.audit()).reason, 'catalog_feed_truncated_csv');
  assert.equal((await fixture({ catalogCsv: 'x'.repeat(2 * 1024 * 1024 + 1) }).source.audit()).reason, 'catalog_feed_too_large');
});

test('inventory is bounded even without content-length and arbitrary error messages stay private', async () => {
  assert.equal((await fixture({ sourceOptions: { maxInventoryBytes: 512 } }).source.audit()).reason, 'source_too_large');
  const f = fixture({ respond: (url) => {
    if (url === URLS.inventory) throw Object.assign(new Error('private provider details'), { code: 'private-provider-code' });
  } });
  const result = await f.source.audit();
  assert.equal(result.reason, 'source_unavailable'); assert.equal(JSON.stringify(result).includes('private'), false);
});

test('only fixed source URLs are fetched; untrusted photo and advert hosts are rejected', async () => {
  const f = fixture({ sourceOptions: { inventoryUrl: 'http://127.0.0.1/admin', feedUrl: 'https://example.com/private' } });
  assert.equal((await f.source.audit()).valid, true);
  assert.deepEqual(new Set(f.calls.map((call) => call.url)), new Set(Object.values(URLS)));
  for (const override of [{ photos: ['http://127.0.0.1/photo'] }, { url: 'https://standvirtual.com.attacker.invalid/carros/anuncio/tesla-ID8stock00.html' }]) {
    const ads = f.ads.map((ad, i) => i === 0 ? { ...ad, ...override } : ad);
    assert.equal((await fixture({ ads }).source.audit()).reason, 'source_invalid_vehicle');
  }
});

test('Google export redirects are bounded and cannot reach arbitrary hosts', async () => {
  const f = fixture({ respond: (url) => url === URLS.catalog ? new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }) : null });
  assert.equal((await f.source.audit()).reason, 'feed_redirect_not_allowed');
  assert.equal(f.calls.some((call) => call.url.includes('127.0.0.1')), false);
  const loop = fixture({ respond: (url) => url === URLS.catalog ? new Response('', { status: 302, headers: { location: URLS.catalog } }) : null });
  assert.equal((await loop.source.audit()).reason, 'feed_redirect_limit');
  assert.equal(loop.calls.filter((call) => call.url === URLS.catalog).length, 5);
});

test('legitimate Google Sheets CDN redirects remain compatible with public exports', async () => {
  const target = 'https://doc-0k-8o-sheets.googleusercontent.com/export/example/csv';
  const initial = fixture();
  const f = fixture({ respond: (url) => {
    if (url === URLS.catalog) return new Response('', { status: 302, headers: { location: target } });
    if (url === target) return new Response(csv(initial.items), { headers: { 'content-type': 'text/csv' } });
  } });
  assert.equal((await f.source.audit()).valid, true);
  assert.ok(f.calls.filter((call) => call.url !== URLS.inventory).every((call) => call.redirect === 'manual'));
});

test('wrapper accepts injected fetch/time and a timed-out source returns a safe failure', async () => {
  const f = fixture();
  assert.equal((await auditMetaCatalogSource({ fetchImpl: f.fetchImpl, now: () => Date.parse(checkedAt) })).valid, true);
  const timeout = fixture({ respond: (url) => { if (url === URLS.inventory) throw new DOMException('provider location must stay private', 'TimeoutError'); } });
  const result = await timeout.source.audit();
  assert.equal(result.reason, 'source_timeout'); assert.equal(JSON.stringify(result).includes('private'), false);
});
