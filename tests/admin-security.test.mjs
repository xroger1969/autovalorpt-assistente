import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_COOKIE_NAME,
  adminRequestAuthorized,
  adminTokenMatches,
  clearAdminCookie,
  hashAdminToken,
  readAdminToken,
  setAdminCookie
} from '../lib/admin-security.js';

const ACCESS_CODE = 'farol-cedro-lagoa-4827';
const ACCESS_HASH = hashAdminToken(ACCESS_CODE);

test('aceita apenas o código administrativo correto', () => {
  assert.equal(adminTokenMatches(ACCESS_CODE, ACCESS_HASH), true);
  assert.equal(adminTokenMatches('ponte-lima-campo-9153', ACCESS_HASH), false);
  assert.equal(adminTokenMatches('curto', ACCESS_HASH), false);
  assert.equal(adminTokenMatches(ACCESS_CODE, 'hash-invalida'), false);
});

test('lê autorização Bearer válida', () => {
  const req = { headers: { authorization: `Bearer ${ACCESS_CODE}` } };
  assert.equal(readAdminToken(req), ACCESS_CODE);
  assert.equal(adminRequestAuthorized(req, ACCESS_HASH), true);
});

test('lê autorização do cookie privado', () => {
  const req = { headers: { cookie: `outro=1; ${ADMIN_COOKIE_NAME}=${ACCESS_CODE}; tema=claro` } };
  assert.equal(readAdminToken(req), ACCESS_CODE);
  assert.equal(adminRequestAuthorized(req, ACCESS_HASH), true);
});

test('cria cookie HttpOnly, Secure e SameSite Strict', () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  setAdminCookie(res, ACCESS_CODE);
  assert.match(headers['Set-Cookie'], /HttpOnly/);
  assert.match(headers['Set-Cookie'], /Secure/);
  assert.match(headers['Set-Cookie'], /SameSite=Strict/);
  assert.match(headers['Set-Cookie'], /Path=\//);
});

test('termina a sessão com Max-Age zero', () => {
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  clearAdminCookie(res);
  assert.match(headers['Set-Cookie'], /Max-Age=0/);
});
