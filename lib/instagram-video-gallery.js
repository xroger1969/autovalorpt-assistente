import { validInstagramImageSource } from './instagram-image.js';

const INVENTORY = 'https://spremium.standvirtual.com/inventory';
const MAX_BYTES = 4 * 1024 * 1024;
const identity = url => String(url).replace(/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/, '/image');

// Only the already-authorised dealer inventory can supply additional angles.
// Never take photographs from recommendations or another advertiser.
export function instagramGalleryFromInventory(item, html) {
  const scripts = [...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => /(?:^|\s)id\s*=\s*(["'])__NEXT_DATA__\1/i.test(match[1]));
  if (scripts.length !== 1) return [];
  let page;
  try { page = JSON.parse(scripts[0][2])?.props?.pageProps; } catch { return []; }
  const matches = [];
  for (const entry of Object.values(page?.urqlState || {})) {
    let data;
    try { data = typeof entry?.data === 'string' ? JSON.parse(entry.data) : entry?.data; } catch { return []; }
    const ads = data?.publishedAds?.ads;
    if (!Array.isArray(ads)) continue;
    matches.push(...ads.filter(ad => ad?.url === item.link));
  }
  if (!matches.length) return [];
  let photos;
  for (const ad of matches) {
    if (!ad.url.endsWith(`-${item.id}.html`) || ad.price?.currencyCode !== 'EUR' ||
        !Number.isSafeInteger(ad.price.grossMinorAmount) ||
        ad.price.grossMinorAmount !== Math.round(Number(String(item.price).split(' ')[0]) * 100) ||
        !Array.isArray(ad.photos) || !ad.photos.length || ad.photos.length > 100 ||
        ad.photos.some(url => !validInstagramImageSource(url)) ||
        identity(ad.photos[0]) !== identity(item.image_link)) return [];
    const candidate = [...new Set(ad.photos.map(identity))].slice(0, 5);
    if (photos && JSON.stringify(photos) !== JSON.stringify(candidate)) return [];
    photos = candidate;
  }
  return photos.map(url => `${url};s=1440x0`);
}

export async function fetchInstagramGallery(item, fetchImpl = fetch) {
  if (typeof item.link !== 'string' || !/^https:\/\/(?:www\.)?standvirtual\.com\/carros\/anuncio\/[^/?#]+-ID[A-Za-z0-9]+\.html$/.test(item.link)) return [];
  try {
    const response = await fetchImpl(INVENTORY, { redirect: 'error', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) return [];
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body.cancel(); return []; }
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const value = await reader.read(); if (value.done) break;
        bytes += value.value.length; if (bytes > MAX_BYTES) return [];
        chunks.push(value.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return instagramGalleryFromInventory(item, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return []; }
}
