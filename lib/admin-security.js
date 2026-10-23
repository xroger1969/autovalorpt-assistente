import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = '__Host-avpt_admin';
export const ADMIN_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;
const LEGACY_COOKIE_NAME = 'avpt_retomas_admin';
const ACCESS_CODE_PATTERN = /^[A-Za-z0-9._-]{24,128}$/;
const SESSION_ISSUER = 'autovalorpt-admin';

export function hashAdminToken(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function adminConfigured(env = process.env) {
  return /^[a-f0-9]{64}$/i.test(String(env.ADMIN_ACCESS_HASH || '')) &&
    String(env.ADMIN_SESSION_SECRET || '').length >= 32;
}

export function adminTokenMatches(value = '', expectedHash = process.env.ADMIN_ACCESS_HASH || '') {
  if (!ACCESS_CODE_PATTERN.test(String(value)) || !/^[a-f0-9]{64}$/i.test(String(expectedHash))) return false;
  const actual = Buffer.from(hashAdminToken(value), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Deriving the signing key from both settings revokes every session when either
// the private access code or the session secret is rotated.
function signingKey(env) {
  if (!adminConfigured(env)) return null;
  return createHmac('sha256', String(env.ADMIN_SESSION_SECRET))
    .update(`autovalorpt:admin-session:v1:${String(env.ADMIN_ACCESS_HASH).toLowerCase()}`)
    .digest();
}

export function createAdminSession(env = process.env, now = Date.now()) {
  const key = signingKey(env);
  if (!key) throw new Error('Acesso administrativo não configurado.');
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1, iss: SESSION_ISSUER, scope: 'admin', iat,
    exp: iat + ADMIN_COOKIE_MAX_AGE,
    nonce: randomBytes(18).toString('base64url')
  })).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAdminSession(value = '', env = process.env, now = Date.now()) {
  const key = signingKey(env);
  const token = String(value);
  if (!key || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [payload, signature] = token.split('.');
  const expected = createHmac('sha256', key).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const seconds = Math.floor(now / 1000);
    return session?.v === 1 && session.iss === SESSION_ISSUER && session.scope === 'admin' &&
      Number.isSafeInteger(session.iat) && Number.isSafeInteger(session.exp) &&
      session.iat <= seconds + 30 && session.exp > seconds && session.exp > session.iat &&
      session.exp - session.iat <= ADMIN_COOKIE_MAX_AGE &&
      /^[A-Za-z0-9_-]{24}$/.test(String(session.nonce || ''));
  } catch {
    return false;
  }
}

export function readCookie(req, name = '') {
  const cookieHeader = String(req?.headers?.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
  }
  return '';
}

// A password is accepted only by the login endpoint, never as a reusable Bearer
// credential or as the cookie used by the old implementation.
export function readAdminToken(req) {
  return readCookie(req, ADMIN_COOKIE_NAME);
}

export function adminRequestAuthorized(req, env = process.env, now = Date.now()) {
  return verifyAdminSession(readAdminToken(req), env, now);
}

function cookie(value, maxAge) {
  return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredLegacyCookie() {
  return `${LEGACY_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function setAdminCookie(res, env = process.env, now = Date.now()) {
  res.setHeader('Set-Cookie', [cookie(createAdminSession(env, now), ADMIN_COOKIE_MAX_AGE), expiredLegacyCookie()]);
}

export function clearAdminCookie(res) {
  res.setHeader('Set-Cookie', [cookie('', 0), expiredLegacyCookie()]);
}
