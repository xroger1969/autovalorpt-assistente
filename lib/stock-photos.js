import { validInstagramImageSource } from './instagram-image.js';

export const MAX_STOCK_PHOTOS = 100;
export const MAX_CATALOG_ADDITIONAL_PHOTOS = 20;

export function stockPhotoIdentity(value) {
  if (!validInstagramImageSource(value)) return null;
  const url = new URL(value);
  if (!/^\/v1\/files\/[^/]+\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/.test(url.pathname) || url.search) return null;
  url.pathname = url.pathname.replace(/\/image(?:;[a-z]=[A-Za-z0-9,._-]+)*$/, '/image');
  return url.href;
}

export function originalPhotoGallery(values, cover) {
  if (!Array.isArray(values) || !values.length || values.length > MAX_STOCK_PHOTOS) return null;
  const photos = values.map(stockPhotoIdentity);
  if (photos.includes(null) || cover && photos[0] !== stockPhotoIdentity(cover)) return null;
  return [...new Set(photos)];
}

export function additionalStockPhotos(item) {
  if (item.additional_image_link === undefined || item.additional_image_link === '') return [];
  if (typeof item.additional_image_link !== 'string') return null;
  const values = item.additional_image_link.split(',');
  if (values.length > MAX_CATALOG_ADDITIONAL_PHOTOS) return null;
  const photos = values.map(value => stockPhotoIdentity(value.trim()));
  if (photos.includes(null) || new Set(photos).size !== photos.length || photos.includes(stockPhotoIdentity(item.image_link))) return null;
  return photos;
}
