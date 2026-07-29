import { createHash, timingSafeEqual } from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'avpt_retomas_admin';
export const ADMIN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

// Only the SHA-256 digest is stored in the repository. The access code itself
// is kept by the owner and never reaches GitHub.
export const ADMIN_TOKEN_HASH = '4d91c1c04da72a51337305ada0737fafb863c9aaa1ba320e89e42aaa859ec907';

export function hashAdminToken(value = '') {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function adminTokenMatches(value = '', expectedHash = ADMIN_TOKEN_HASH) {
  if (!/^[a-f0-9]{48}$/i.test(String(value)) || !/^[a-f0-9]{64}$/i.test(String(expectedHash))) {
    return false;
  }

  const actual = Buffer.from(hashAdminToken(value), 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function readCookie(req, name = '') {
  const cookieHeader = String(req?.headers?.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function readAdminToken(req) {
  const authorization = String(req?.headers?.authorization || '');
  const bearer = authorization.match(/^Bearer\s+([a-f0-9]{48})$/i);
  if (bearer) return bearer[1];
  return readCookie(req, ADMIN_COOKIE_NAME);
}

export function adminRequestAuthorized(req, expectedHash = ADMIN_TOKEN_HASH) {
  return adminTokenMatches(readAdminToken(req), expectedHash);
}

export function setAdminCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${ADMIN_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`
  );
}

export function clearAdminCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
  );
}
