import crypto from 'node:crypto';

const ARCHIVE_SCOPE = 'retomas:read-write';
const ARCHIVE_ACCESS_MS = 30 * 60 * 1000;

function secret(env = process.env) {
  const base = String(env?.ONESIGNAL_AUTOVALORPT_API_KEY || env?.ONESIGNAL_API_KEY || '').trim();
  return base ? `${base}:autovalorpt:arquivo:v1` : '';
}

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signature(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

export function archiveAccessConfigured(env = process.env) {
  return Boolean(secret(env));
}

export function createArchiveAccessToken(now = Date.now(), env = process.env) {
  const key = secret(env);
  if (!key) throw new Error('Acesso privado ao arquivo não configurado.');
  const payload = encode({
    v: 1,
    scope: ARCHIVE_SCOPE,
    iat: now,
    exp: now + ARCHIVE_ACCESS_MS,
    nonce: crypto.randomBytes(12).toString('base64url')
  });
  return `${payload}.${signature(payload, key)}`;
}

export function verifyArchiveAccessToken(token = '', now = Date.now(), env = process.env) {
  const key = secret(env);
  if (!key) return false;
  const [payload, receivedSignature, extra] = String(token || '').split('.');
  if (!payload || !receivedSignature || extra) return false;

  const expected = signature(payload, key);
  const receivedBuffer = Buffer.from(receivedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(receivedBuffer, expectedBuffer)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data?.v === 1 &&
      data?.scope === ARCHIVE_SCOPE &&
      Number.isFinite(data?.iat) &&
      Number.isFinite(data?.exp) &&
      data.exp > now &&
      data.iat <= now + 60_000 &&
      data.exp - data.iat <= ARCHIVE_ACCESS_MS + 5_000;
  } catch {
    return false;
  }
}

export function archiveAccessLifetimeMs() {
  return ARCHIVE_ACCESS_MS;
}
