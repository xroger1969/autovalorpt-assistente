import { createHmac, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AGE_SECONDS = 2 * 60 * 60;
const fail = (code) => Object.assign(new Error(code), { code });

export function validInstagramImageSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'ireland.apollo.olxcdn.com' &&
      !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/v1/files/') && url.href.length <= 1500;
  } catch { return false; }
}

function imageOrigin(env) {
  const source = env.INSTAGRAM_PUBLIC_BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === '/' ? url.origin : '';
  } catch { return ''; }
}

export function instagramImagesConfigured(env = process.env) {
  return Boolean(imageOrigin(env)) && String(env.ADMIN_SESSION_SECRET || '').length >= 32;
}

function signature(source, expiry, env) {
  return createHmac('sha256', env.ADMIN_SESSION_SECRET).update(`autovalorpt:instagram-image:v1\n${expiry}\n${source}`).digest();
}

export function signInstagramImageUrl(source, env = process.env, now = Date.now()) {
  if (!instagramImagesConfigured(env) || !validInstagramImageSource(source)) throw fail('image_not_configured');
  const expires = String(Math.floor(now / 1000) + MAX_AGE_SECONDS);
  const url = new URL('/api/stock', imageOrigin(env));
  url.searchParams.set('integration', 'instagram-image');
  url.searchParams.set('src', source); url.searchParams.set('expires', expires);
  url.searchParams.set('signature', signature(source, expires, env).toString('base64url'));
  return url.href;
}

export function verifyInstagramImageQuery(query, env = process.env, now = Date.now()) {
  const source = typeof query?.src === 'string' ? query.src : '';
  const expires = typeof query?.expires === 'string' ? query.expires : '';
  const signed = typeof query?.signature === 'string' ? query.signature : '';
  const seconds = Math.floor(now / 1000);
  if (String(env.ADMIN_SESSION_SECRET || '').length < 32 || !validInstagramImageSource(source) ||
    !/^\d{10}$/.test(expires) || Number(expires) < seconds || Number(expires) > seconds + MAX_AGE_SECONDS || !/^[A-Za-z0-9_-]{43}$/.test(signed)) return '';
  const actual = Buffer.from(signed, 'base64url'); const expected = signature(source, expires, env);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? source : '';
}

export async function instagramCompatibleJpeg(input) {
  if (!Buffer.isBuffer(input) || !input.length || input.length > MAX_BYTES) throw fail('image_size_invalid');
  // No crop: preserve the complete vehicle photograph and add neutral padding.
  const normalized = await sharp(input, { limitInputPixels: 20_000_000, failOn: 'error', animated: false })
    .rotate().resize({ width: 1440, height: 1800, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb').jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const width = Math.max(320, normalized.info.width, Math.ceil(normalized.info.height * 4 / 5));
  const height = Math.max(normalized.info.height, Math.ceil(width / 1.91));
  const horizontal = width - normalized.info.width; const vertical = height - normalized.info.height;
  const output = await sharp(normalized.data).extend({
    left: Math.floor(horizontal / 2), right: Math.ceil(horizontal / 2), top: Math.floor(vertical / 2), bottom: Math.ceil(vertical / 2),
    background: { r: 18, g: 24, b: 32 },
  }).toColorspace('srgb').jpeg({ quality: 90 }).toBuffer();
  if (output.length > MAX_BYTES) throw fail('image_output_too_large');
  return output;
}

export async function fetchInstagramImage(source, fetchImpl = fetch) {
  if (!validInstagramImageSource(source)) throw fail('image_source_not_allowed');
  const response = await fetchImpl(source, { headers: { Accept: 'image/jpeg,image/png,image/webp' }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  if (!response.ok || !/^image\/(?:jpeg|png|webp)(?:;|$)/i.test(response.headers.get('content-type') || '') || !response.body) throw fail('image_unavailable');
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw fail('image_too_large');
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length; if (bytes > MAX_BYTES) throw fail('image_too_large'); chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return await instagramCompatibleJpeg(Buffer.concat(chunks));
}
