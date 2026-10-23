import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, createHmac } from 'node:crypto';
import {
  ADMIN_COOKIE_NAME, ADMIN_COOKIE_MAX_AGE,
  adminConfigured, adminRequestAuthorized, adminTokenMatches, clearAdminCookie,
  createAdminSession, hashAdminToken, readAdminToken, setAdminCookie, verifyAdminSession
} from '../lib/admin-security.js';
import handler from '../api/admin-session.js';
import archiveAccessHandler from '../api/archive-access.js';
import { createArchiveAccessToken, verifyArchiveAccessToken } from '../lib/archive-auth.js';

const ACCESS_CODE = randomBytes(32).toString('base64url');
const env = { ADMIN_ACCESS_HASH: hashAdminToken(ACCESS_CODE), ADMIN_SESSION_SECRET: randomBytes(48).toString('base64url') };
const now = Date.parse('2026-10-23T12:00:00Z');
const request = value => ({ headers: { cookie: `${ADMIN_COOKIE_NAME}=${value}` } });
const response = () => ({
  headers: {}, statusCode: 200, data: null,
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(data) { this.data = data; return this; }
});

// Every fixture is generated for this process. No production code or digest is
// present in the repository or needed by the test suite.
test('aceita apenas o código aleatório correto e exige configuração privada', () => {
  assert.equal(adminConfigured(env), true);
  assert.equal(adminConfigured({}), false);
  assert.equal(adminTokenMatches(ACCESS_CODE, env.ADMIN_ACCESS_HASH), true);
  assert.equal(adminTokenMatches(randomBytes(32).toString('base64url'), env.ADMIN_ACCESS_HASH), false);
  assert.equal(adminTokenMatches('curto', env.ADMIN_ACCESS_HASH), false);
  assert.equal(adminTokenMatches(ACCESS_CODE, ''), false);
  assert.throws(() => createAdminSession({}), /configurado/);
});

test('código em Bearer ou no antigo cookie nunca autoriza pedidos', () => {
  assert.equal(adminRequestAuthorized({ headers: { authorization: `Bearer ${ACCESS_CODE}` } }, env, now), false);
  assert.equal(adminRequestAuthorized({ headers: { cookie: `avpt_retomas_admin=${ACCESS_CODE}` } }, env, now), false);
  assert.equal(adminRequestAuthorized(request(ACCESS_CODE), env, now), false);
  assert.equal(readAdminToken({ headers: { authorization: `Bearer ${ACCESS_CODE}` } }), '');
});

test('sessão assinada válida expira no servidor mesmo que o cookie seja conservado', () => {
  const session = createAdminSession(env, now);
  assert.equal(session.includes(ACCESS_CODE), false);
  assert.equal(adminRequestAuthorized(request(session), env, now), true);
  assert.equal(verifyAdminSession(session, env, now + ADMIN_COOKIE_MAX_AGE * 1000 - 1), true);
  assert.equal(verifyAdminSession(session, env, now + ADMIN_COOKIE_MAX_AGE * 1000), false);
  assert.equal(verifyAdminSession(session, env, now - 60_000), false);
});

test('rotação do código ou segredo revoga sessões anteriores', () => {
  const session = createAdminSession(env, now);
  assert.equal(verifyAdminSession(session, { ...env, ADMIN_ACCESS_HASH: hashAdminToken(randomBytes(32).toString('base64url')) }, now), false);
  assert.equal(verifyAdminSession(session, { ...env, ADMIN_SESSION_SECRET: randomBytes(48).toString('base64url') }, now), false);
  assert.equal(verifyAdminSession(session, {}, now), false);
});

test('assinatura alterada, payload alterado ou duração excessiva são rejeitados', () => {
  const session = createAdminSession(env, now);
  const [payload, signature] = session.split('.');
  assert.equal(verifyAdminSession(`${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`, env, now), false);
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  claims.exp += 1;
  const changed = Buffer.from(JSON.stringify(claims)).toString('base64url');
  assert.equal(verifyAdminSession(`${changed}.${signature}`, env, now), false);
  const key = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(`autovalorpt:admin-session:v1:${env.ADMIN_ACCESS_HASH}`).digest();
  const validSignature = createHmac('sha256', key).update(changed).digest('base64url');
  assert.equal(verifyAdminSession(`${changed}.${validSignature}`, env, now), false);
});

test('cria cookie com prefixo Host, HttpOnly, Secure e SameSite Strict e apaga o antigo', () => {
  const res = response();
  setAdminCookie(res, env, now);
  const [sessionCookie, legacyCookie] = res.headers['Set-Cookie'];
  assert.match(sessionCookie, /^__Host-avpt_admin=/);
  assert.match(sessionCookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.match(sessionCookie, /Path=\//);
  assert.doesNotMatch(sessionCookie, /Domain=/);
  assert.equal(sessionCookie.includes(ACCESS_CODE), false);
  assert.match(legacyCookie, /avpt_retomas_admin=;.*Max-Age=0/);
  const cookieValue = decodeURIComponent(sessionCookie.split(';')[0].split('=')[1]);
  assert.equal(verifyAdminSession(cookieValue, env, now), true);
  clearAdminCookie(res);
  assert.ok(res.headers['Set-Cookie'].every(value => /Max-Age=0/.test(value)));
});

test('login emite sessão; GET informa o estado sem expor token; origem externa é recusada', async () => {
  const originalHash = process.env.ADMIN_ACCESS_HASH;
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  Object.assign(process.env, env);
  try {
    const login = response();
    await handler({ method: 'POST', body: { access: ACCESS_CODE }, headers: { host: 'test.local', origin: 'https://test.local', 'x-forwarded-for': '192.0.2.1' } }, login);
    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.data, { ok: true });
    const sessionCookie = login.headers['Set-Cookie'][0].split(';')[0];
    const status = response();
    await handler({ method: 'GET', headers: { cookie: sessionCookie } }, status);
    assert.deepEqual(status.data, { ok: true, configured: true, authenticated: true });
    const external = response();
    await handler({ method: 'POST', body: { access: ACCESS_CODE }, headers: { host: 'test.local', origin: 'https://attacker.invalid' } }, external);
    assert.equal(external.statusCode, 403);
  } finally {
    if (originalHash === undefined) delete process.env.ADMIN_ACCESS_HASH; else process.env.ADMIN_ACCESS_HASH = originalHash;
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});

test('repetidas tentativas de login são limitadas', async () => {
  const originalHash = process.env.ADMIN_ACCESS_HASH;
  const originalSecret = process.env.ADMIN_SESSION_SECRET;
  Object.assign(process.env, env);
  try {
    let last;
    for (let i = 0; i < 11; i++) {
      last = response();
      await handler({ method: 'POST', body: { access: 'invalid' }, headers: { 'x-forwarded-for': '192.0.2.2' } }, last);
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.headers['Retry-After'], '900');
  } finally {
    if (originalHash === undefined) delete process.env.ADMIN_ACCESS_HASH; else process.env.ADMIN_ACCESS_HASH = originalHash;
    if (originalSecret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = originalSecret;
  }
});

test('links antigos de arquivo já não concedem acesso nem geram notificações', async () => {
  assert.equal(verifyArchiveAccessToken('any-legacy-token'), false);
  assert.throws(createArchiveAccessToken, /sessão administrativa/);
  const res = response();
  await archiveAccessHandler({ method: 'POST', body: {}, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.data.url, '/retomas.html');
});
