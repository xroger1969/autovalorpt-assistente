import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_BYTES,
  UPLOAD_LIFETIME_MS,
  blobStorageConfigured,
  createPhotoSessionIds,
  hashViewerToken,
  isValidBatchId,
  isValidViewerToken,
  normalizePhotoType,
  photoPath,
  sessionHasExpired,
  uploadTokenAuthorized,
  readJsonBody,
  viewerTokenMatches
} from '../lib/photo-security.js';

test('reconhece ligações Blob com token estático ou OIDC da Vercel', () => {
  assert.equal(blobStorageConfigured({ BLOB_READ_WRITE_TOKEN: 'rw-token' }), true);
  assert.equal(blobStorageConfigured({ BLOB_STORE_ID: 'store_123' }), true);
  assert.equal(blobStorageConfigured({}), false);
});

test('cria identificadores fortes e valida o token da galeria', () => {
  const { batchId, viewerToken, uploadToken } = createPhotoSessionIds();
  const hash = hashViewerToken(viewerToken);

  assert.equal(isValidBatchId(batchId), true);
  assert.equal(isValidViewerToken(viewerToken), true);
  assert.equal(isValidViewerToken(uploadToken), true);
  assert.notEqual(uploadToken, viewerToken);
  assert.equal(viewerTokenMatches(viewerToken, hash), true);
  const differentLastCharacter = viewerToken.endsWith('A') ? 'B' : 'A';
  assert.equal(viewerTokenMatches(`${viewerToken.slice(0, -1)}${differentLastCharacter}`, hash), false);
});

test('limita formatos e constrói caminhos isolados por retoma', () => {
  const batchId = 'a'.repeat(32);

  assert.equal(normalizePhotoType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(normalizePhotoType('application/pdf'), '');
  assert.equal(photoPath(batchId, 1, 'image/jpeg'), `retomas/${batchId}/fotografias/01`);
  assert.equal(photoPath(batchId, 10, 'image/heic'), `retomas/${batchId}/fotografias/10`);
  assert.throws(() => photoPath(batchId, 11, 'image/jpeg'));
  assert.throws(() => photoPath(batchId, 1, 'application/pdf'));
  assert.equal(MAX_PHOTO_BYTES, 10 * 1024 * 1024);
});

test('cada posição é única mesmo quando se altera o formato, limitando a dez objetos', () => {
  const paths = new Set();
  for (let index = 1; index <= 10; index += 1) {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      paths.add(photoPath('a'.repeat(32), index, type));
    }
  }
  assert.equal(paths.size, 10);
  assert.throws(() => photoPath('a'.repeat(32), 0, 'image/jpeg'));
  assert.throws(() => photoPath('a'.repeat(32), 1.5, 'image/jpeg'));
});

test('o token de leitura não escreve e a autorização de escrita expira em duas horas', () => {
  const { viewerToken, uploadToken } = createPhotoSessionIds();
  const now = Date.now();
  const manifest = {
    version: 2,
    createdAt: new Date(now).toISOString(),
    uploadExpiresAt: new Date(now + UPLOAD_LIFETIME_MS).toISOString(),
    viewerTokenHash: hashViewerToken(viewerToken),
    uploadTokenHash: hashViewerToken(uploadToken)
  };
  assert.equal(uploadTokenAuthorized(manifest, viewerToken, now), false);
  assert.equal(uploadTokenAuthorized(manifest, uploadToken, now), true);
  assert.equal(uploadTokenAuthorized(manifest, uploadToken, now + UPLOAD_LIFETIME_MS), false);
  assert.equal(uploadTokenAuthorized({ ...manifest, version: 1 }, uploadToken, now), false);
  assert.equal(viewerTokenMatches('', ''), false);
});

test('limita JSON mesmo quando a plataforma já processou o corpo', async () => {
  await assert.rejects(readJsonBody({ body: { name: 'a'.repeat(100) } }, 20), /demasiado grande/);
  await assert.rejects(readJsonBody({ body: JSON.stringify({ name: 'a'.repeat(100) }) }, 20), /demasiado grande/);
  assert.deepEqual(await readJsonBody({ body: { name: 'Ana' } }, 100), { name: 'Ana' });
});

test('considera expiradas sessões antigas ou sem data válida', () => {
  const recent = { createdAt: new Date().toISOString() };
  const old = { createdAt: '2020-01-01T00:00:00.000Z' };

  assert.equal(sessionHasExpired(recent), false);
  assert.equal(sessionHasExpired(old), true);
  assert.equal(sessionHasExpired({}), true);
});
