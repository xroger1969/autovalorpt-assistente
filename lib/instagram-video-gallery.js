import { validInstagramImageSource } from './instagram-image.js';
import { STOCK_INVENTORIES } from './stock-inventories.js';

const MAX_BYTES = 4 * 1024 * 1024;
const identity = url => String(url).replace(/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/, '/image');

// Only the two authorised dealer inventories can supply additional angles.
// Never take photographs from recommendations or another advertiser.
// null means invalid/ambiguous; [] means the advert is absent from this source.
function galleryCandidate(item, html) {
  const scripts = [...String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(match => /(?:^|\s)id\s*=\s*(["'])__NEXT_DATA__\1/i.test(match[1]));
  if (scripts.length !== 1) return null;
  let page;
  try { page = JSON.parse(scripts[0][2])?.props?.pageProps; } catch { return null; }
  if (!page?.urqlState || typeof page.urqlState !== 'object' || Array.isArray(page.urqlState)) return null;
  const matches = [];
  let groups = 0;
  for (const entry of Object.values(page?.urqlState || {})) {
    let data;
    try { data = typeof entry?.data === 'string' ? JSON.parse(entry.data) : entry?.data; } catch { return null; }
    const ads = data?.publishedAds?.ads;
    if (!Array.isArray(ads)) continue;
    groups++;
    matches.push(...ads.filter(ad => ad?.url === item.link || typeof ad?.url === 'string' && ad.url.endsWith(`-${item.id}.html`)));
  }
  if (!groups) return null;
  if (!matches.length) return [];
  let photos;
  for (const ad of matches) {
    if (ad.url !== item.link || !ad.url.endsWith(`-${item.id}.html`) || ad.price?.currencyCode !== 'EUR' ||
        !Number.isSafeInteger(ad.price.grossMinorAmount) ||
        ad.price.grossMinorAmount !== Math.round(Number(String(item.price).split(' ')[0]) * 100) ||
        !Array.isArray(ad.photos) || !ad.photos.length || ad.photos.length > 100 ||
        ad.photos.some(url => !validInstagramImageSource(url)) ||
        identity(ad.photos[0]) !== identity(item.image_link)) return null;
    const candidate = [...new Set(ad.photos.map(identity))].slice(0, 5);
    if (photos && JSON.stringify(photos) !== JSON.stringify(candidate)) return null;
    photos = candidate;
  }
  return photos.map(url => `${url};s=1440x0`);
}

export function instagramGalleryFromInventory(item, html) {
  return galleryCandidate(item, html) || [];
}

async function fetchInventoryGallery(item, inventory, fetchImpl) {
  try {
    const response = await fetchImpl(inventory.url, { redirect: 'error', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(10000) });
    if (response.url && response.url !== inventory.url) { await response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) return null;
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body.cancel(); return null; }
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      while (true) {
        const value = await reader.read(); if (value.done) break;
        bytes += value.value.length; if (bytes > MAX_BYTES) return null;
        chunks.push(value.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return galleryCandidate(item, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { return null; }
}

export async function fetchInstagramGallery(item, fetchImpl = fetch) {
  if (typeof item.link !== 'string' || !/^https:\/\/(?:www\.)?standvirtual\.com\/carros\/anuncio\/[^/?#]+-ID[A-Za-z0-9]+\.html$/.test(item.link) ||
      typeof item.id !== 'string' || !/^ID[A-Za-z0-9]{5,30}$/.test(item.id) || !item.link.endsWith(`-${item.id}.html`)) return [];
  const candidates = await Promise.all(STOCK_INVENTORIES.map(inventory => fetchInventoryGallery(item, inventory, fetchImpl)));
  if (candidates.some(photos => photos === null)) return [];
  const matches = candidates.filter(photos => photos.length);
  if (!matches.length || matches.some(photos => JSON.stringify(photos) !== JSON.stringify(matches[0]))) return [];
  return matches[0];
}
