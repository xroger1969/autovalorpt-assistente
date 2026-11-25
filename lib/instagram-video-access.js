import { createHmac, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { get, head } from '@vercel/blob';

const ID = /^ID[A-Za-z0-9]{5,30}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_SECONDS = 2 * 3600;

export function instagramVideoPath(id, fingerprint) {
  if (!ID.test(id) || !HASH.test(fingerprint)) throw Object.assign(new Error('video_identifier_invalid'), { code: 'video_identifier_invalid' });
  return `instagram/v1/production/videos/${id}-${fingerprint}.mp4`;
}

function origin(env) {
  try {
    const value = env.INSTAGRAM_PUBLIC_BASE_URL || `https://${env.VERCEL_PROJECT_PRODUCTION_URL || ''}`;
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
  } catch { return ''; }
}
export function instagramVideoAccessConfigured(env) { return Boolean(origin(env)) && String(env.ADMIN_SESSION_SECRET || '').length >= 32; }
function signature(id, fingerprint, expires, env) {
  return createHmac('sha256', env.ADMIN_SESSION_SECRET).update(`autovalorpt:instagram-video:v1\n${id}\n${fingerprint}\n${expires}`).digest();
}
export function signInstagramVideoUrl(id, fingerprint, env, now = Date.now()) {
  instagramVideoPath(id, fingerprint);
  if (!instagramVideoAccessConfigured(env)) throw Object.assign(new Error('video_signing_not_configured'), { code: 'video_signing_not_configured' });
  const expires = String(Math.floor(now / 1000) + MAX_SECONDS);
  const url = new URL('/api/stock', origin(env));
  for (const [key, value] of Object.entries({ integration: 'instagram-video', id, fingerprint, expires, signature: signature(id, fingerprint, expires, env).toString('base64url') })) url.searchParams.set(key, value);
  return url.href;
}
export function verifyInstagramVideoQuery(query, env, now = Date.now()) {
  const { id, fingerprint, expires, signature: signed } = query || {};
  const seconds = Math.floor(now / 1000);
  if (!instagramVideoAccessConfigured(env) || typeof id !== 'string' || !ID.test(id) || typeof fingerprint !== 'string' || !HASH.test(fingerprint) ||
      typeof expires !== 'string' || !/^\d{10}$/.test(expires) || Number(expires) < seconds || Number(expires) > seconds + MAX_SECONDS ||
      typeof signed !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signed)) return null;
  const actual = Buffer.from(signed, 'base64url'); const expected = signature(id, fingerprint, expires, env);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? instagramVideoPath(id, fingerprint) : null;
}

function byteRange(value, size) {
  const match = typeof value === 'string' && /^bytes=(\d{0,16})-(\d{0,16})$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return start <= end ? { start, end } : null;
}

// Some Blob responses may ignore Range. Forward exactly the promised bytes and
// cancel the upstream stream as soon as the client's range has been delivered.
async function* sliceStream(stream, { start, end }) {
  let offset = 0;
  for await (const chunk of stream) {
    const next = offset + chunk.length;
    if (next > start) yield chunk.subarray(Math.max(0, start - offset), end + 1 - offset);
    if (next > end) return;
    offset = next;
  }
  throw new Error('video_stream_incomplete');
}

// Stream private media through a short-lived capability URL. The signing secret
// and Blob token remain on the server; neither becomes a URL parameter.
export function createInstagramVideoHandler(options = {}) {
  const env = options.env || process.env; const storage = options.storage || { get, head };
  const now = options.now || Date.now;
  // Each path identifies an immutable MP4. Safari can request several ranges
  // for one preview, all of which share the same validated size.
  const sizes = new Map();
  async function getSize(path) {
    if (sizes.has(path)) return sizes.get(path);
    const meta = await storage.head(path, { abortSignal: AbortSignal.timeout(8000) });
    if (!Number.isSafeInteger(meta.size) || meta.size < 1000 || meta.size > MAX_BYTES || meta.contentType !== 'video/mp4') return 0;
    if (sizes.size >= 64) sizes.delete(sizes.keys().next().value);
    sizes.set(path, meta.size);
    return meta.size;
  }
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).end();
    const path = verifyInstagramVideoQuery(req.query, env, now());
    if (!path || env.VERCEL_ENV !== 'production') return res.status(404).end();
    try {
      const size = await getSize(path);
      if (!size) return res.status(404).end();
      const rangeHeader = req.method === 'GET' && req.headers?.range;
      const range = rangeHeader && byteRange(rangeHeader, size);
      res.setHeader('Accept-Ranges', 'bytes');
      if (rangeHeader && !range) {
        res.setHeader('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="AutoValorPT_${req.query.id}.mp4"`);
      res.setHeader('Content-Type', 'video/mp4');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', String(size));
        return res.status(200).end();
      }
      const result = await storage.get(path, { access: 'private', abortSignal: AbortSignal.timeout(30000),
        ...(range && { headers: { Range: `bytes=${range.start}-${range.end}` } }) });
      if (!result?.stream || result.statusCode !== 200) return res.status(404).end();
      const partial = result.headers?.get('content-range');
      const expected = range && `bytes ${range.start}-${range.end}/${size}`;
      if (partial && partial !== expected) {
        await result.stream.cancel();
        return res.status(503).end();
      }
      if (range) res.setHeader('Content-Range', expected);
      res.setHeader('Content-Length', String(range ? range.end - range.start + 1 : size));
      res.status(range ? 206 : 200); res.flushHeaders?.();
      const stream = range && !partial ? sliceStream(result.stream, range) : Readable.fromWeb(result.stream);
      await pipeline(stream, res);
    } catch {
      if (!res.headersSent) return res.status(503).end();
      res.destroy?.();
    }
  };
}
export default createInstagramVideoHandler();
