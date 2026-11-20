import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramGalleryFromInventory, fetchInstagramGallery } from '../lib/instagram-video-gallery.js';
import { STOCK_INVENTORIES } from '../lib/stock-inventories.js';

const photo = name => `https://ireland.apollo.olxcdn.com/v1/files/${name}/image`;
const item = { id: 'ID8Q1myC', price: '26990.00 EUR', link: 'https://www.standvirtual.com/carros/anuncio/tesla-model-3-ID8Q1myC.html', image_link: `${photo('hero')};q=100;s=600x0` };
const advert = { url: item.link, price: { grossMinorAmount: 2699000, currencyCode: 'EUR' }, photos: [photo('hero'), photo('rear'), photo('interior')] };
const html = ads => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { urqlState: { a: { data: JSON.stringify({ publishedAds: { ads } }) } } } } })}</script>`;

test('gallery selects only the exact current car with matching price and original photograph', () => {
  const other = { ...advert, url: advert.url.replace(item.id, 'IDanother'), photos: [photo('foreign')] };
  assert.deepEqual(instagramGalleryFromInventory(item, html([other, advert])), advert.photos.map(p => `${p};s=1440x0`));
  for (const changed of [{ price: { grossMinorAmount: 2699900, currencyCode: 'EUR' } },
    { photos: [photo('different-car')] }, { photos: [photo('hero'), 'https://example.com/photo.jpg'] }]) {
    assert.deepEqual(instagramGalleryFromInventory(item, html([{ ...advert, ...changed }])), []);
  }
});

test('ambiguous, missing or malformed gallery is not trusted', () => {
  assert.deepEqual(instagramGalleryFromInventory(item, html([advert, { ...advert, photos: [photo('hero'), photo('other')] }])), []);
  assert.deepEqual(instagramGalleryFromInventory(item, html([])), []);
  assert.deepEqual(instagramGalleryFromInventory(item, '<script id="__NEXT_DATA__">{bad}</script>'), []);
});

test('gallery never fetches user-selected destinations or follows redirects', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    calls++; assert.ok(STOCK_INVENTORIES.some(inventory => inventory.url === url)); assert.equal(init.redirect, 'error');
    return new Response(html([advert]), { headers: { 'content-type': 'text/html' } });
  };
  assert.deepEqual(await fetchInstagramGallery({ ...item, link: 'https://localhost/private' }, fetchImpl), []);
  assert.equal(calls, 0);
  assert.equal((await fetchInstagramGallery(item, fetchImpl)).length, 3);
  assert.equal(calls, 2);
});

test('gallery finds AutoValorPT vehicles in their own inventory without using Samucar photographs', async () => {
  const privateItem = { ...item, id: 'ID8Q1lYB', link: 'https://www.standvirtual.com/carros/anuncio/bmw-x1-ID8Q1lYB.html', price: '22990.00 EUR', image_link: photo('bmw-hero') };
  const privateAdvert = { url: privateItem.link, price: { grossMinorAmount: 2299000, currencyCode: 'EUR' }, photos: [photo('bmw-hero'), photo('bmw-interior')] };
  const visited = [];
  const photos = await fetchInstagramGallery(privateItem, async url => {
    visited.push(url);
    return new Response(html(url === STOCK_INVENTORIES.find(source => source.id === 'autovalorpt').url ? [privateAdvert] : [advert]), { headers: { 'content-type': 'text/html' } });
  });
  assert.deepEqual(visited.sort(), STOCK_INVENTORIES.map(source => source.url).sort());
  assert.deepEqual(photos, privateAdvert.photos.map(p => `${p};s=1440x0`));
});

test('two source galleries must agree for the same advert and any unreadable source triggers the feed fallback', async () => {
  for (const conflictingAdvert of [
    { ...advert, photos: [photo('hero'), photo('other')] },
    { ...advert, price: { grossMinorAmount: 2299000, currencyCode: 'EUR' } },
    { ...advert, url: advert.url.replace('tesla-model-3-', 'another-slug-') }
  ]) {
    assert.deepEqual(await fetchInstagramGallery(item, async url => new Response(html([
      url === STOCK_INVENTORIES[0].url ? advert : conflictingAdvert
    ]), { headers: { 'content-type': 'text/html' } })), []);
  }
  assert.deepEqual(await fetchInstagramGallery(item, async url => url === STOCK_INVENTORIES[0].url
    ? new Response(html([advert]), { headers: { 'content-type': 'text/html' } })
    : new Response('temporarily unavailable', { status: 503 })), []);
  assert.deepEqual(await fetchInstagramGallery(item, async url => url === STOCK_INVENTORIES[0].url
    ? new Response(html([advert]), { headers: { 'content-type': 'text/html' } })
    : new Response('<script id="__NEXT_DATA__">{bad}</script>', { headers: { 'content-type': 'text/html' } })), []);
});

test('gallery rejects a redirected response even if the transport returns an otherwise matching inventory', async () => {
  assert.deepEqual(await fetchInstagramGallery(item, async () => {
    const response = new Response(html([advert]), { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(response, 'url', { value: 'https://unrelated.example/inventory' });
    return response;
  }), []);
});

test('missing, excessive and unavailable gallery safely falls back to feed photograph', async () => {
  for (const response of [new Response('no', { status: 503 }), new Response(html([advert]), { headers: { 'content-type': 'image/jpeg' } }),
    new Response('large', { headers: { 'content-type': 'text/html', 'content-length': '5000000' } })]) {
    assert.deepEqual(await fetchInstagramGallery(item, async () => response), []);
  }
  assert.deepEqual(await fetchInstagramGallery(item, async () => { throw new Error('network'); }), []);
});
