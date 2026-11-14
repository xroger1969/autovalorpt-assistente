import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramGalleryFromInventory, fetchInstagramGallery } from '../lib/instagram-video-gallery.js';

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
    calls++; assert.equal(url, 'https://spremium.standvirtual.com/inventory'); assert.equal(init.redirect, 'error');
    return new Response(html([advert]), { headers: { 'content-type': 'text/html' } });
  };
  assert.deepEqual(await fetchInstagramGallery({ ...item, link: 'https://localhost/private' }, fetchImpl), []);
  assert.equal(calls, 0);
  assert.equal((await fetchInstagramGallery(item, fetchImpl)).length, 3);
});

test('missing, excessive and unavailable gallery safely falls back to feed photograph', async () => {
  for (const response of [new Response('no', { status: 503 }), new Response(html([advert]), { headers: { 'content-type': 'image/jpeg' } }),
    new Response('large', { headers: { 'content-type': 'text/html', 'content-length': '5000000' } })]) {
    assert.deepEqual(await fetchInstagramGallery(item, async () => response), []);
  }
  assert.deepEqual(await fetchInstagramGallery(item, async () => { throw new Error('network'); }), []);
});
