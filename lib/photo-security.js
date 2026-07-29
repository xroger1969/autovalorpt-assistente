import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const SESSION_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

export const ALLOWED_PHOTO_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
]);

const CONTENT_TYPE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
});

export function cleanText(value = '', max = 180) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function createPhotoSessionIds() {
  return {
    batchId: randomBytes(16).toString('hex'),
    viewerToken: randomBytes(32).toString('base64url')
  };
}

export function isValidBatchId(value = '') {
  return /^[a-f0-9]{32}$/.test(String(value));
}

export function isValidViewerToken(value = '') {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value));
}

export function hashViewerToken(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function viewerTokenMatches(value = '', expectedHash = '') {
  const actual = Buffer.from(hashViewerToken(value), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizePhotoType(value = '') {
  const normalized = String(value).toLowerCase().split(';')[0].trim();
  return ALLOWED_PHOTO_TYPES.includes(normalized) ? normalized : '';
}

export function photoExtension(contentType = '') {
  return CONTENT_TYPE_EXTENSIONS[normalizePhotoType(contentType)] || '';
}

export function manifestPath(batchId = '') {
  if (!isValidBatchId(batchId)) throw new Error('Identificador de envio inválido.');
  return `retomas/${batchId}/manifest.json`;
}

export function photoPrefix(batchId = '') {
  if (!isValidBatchId(batchId)) throw new Error('Identificador de envio inválido.');
  return `retomas/${batchId}/fotografias/`;
}

export function photoPath(batchId = '', index = 0, contentType = '') {
  const extension = photoExtension(contentType);
  const position = Number(index);
  if (!isValidBatchId(batchId) || !Number.isInteger(position) || position < 1 || position > MAX_PHOTOS || !extension) {
    throw new Error('Dados da fotografia inválidos.');
  }
  return `${photoPrefix(batchId)}${String(position).padStart(2, '0')}.${extension}`;
}

export function sessionHasExpired(manifest = {}, now = Date.now()) {
  const createdAt = Date.parse(String(manifest?.createdAt || ''));
  return !Number.isFinite(createdAt) || now - createdAt > SESSION_LIFETIME_MS;
}

export function sameOriginRequest(req) {
  const origin = String(req?.headers?.origin || '').trim();
  if (!origin) return true;
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim();
  try {
    return Boolean(forwardedHost) && new URL(origin).host === forwardedHost;
  } catch {
    return false;
  }
}

export async function readJsonBody(req, maxBytes = 24 * 1024) {
  if (req?.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req?.body === 'string') return JSON.parse(req.body || '{}');

  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > maxBytes) throw new Error('Pedido demasiado grande.');
  }
  return JSON.parse(raw || '{}');
}

export function blobStorageConfigured(env = process.env) {
  return Boolean(
    env?.BLOB_READ_WRITE_TOKEN ||
    (env?.VERCEL_OIDC_TOKEN && env?.BLOB_STORE_ID)
  );
}

export function noStoreHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}
