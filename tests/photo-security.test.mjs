import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_BYTES,
  createPhotoSessionIds,
  hashViewerToken,
  isValidBatchId,
  isValidViewerToken,
  normalizePhotoType,
  photoPath,
  sessionHasExpired,
  viewerTokenMatches
} from '../lib/photo-security.js';

test('cria identificadores fortes e valida o token da galeria', () => {
  const { batchId, viewerToken } = createPhotoSessionIds();
  const hash = hashViewerToken(viewerToken);

  assert.equal(isValidBatchId(batchId), true);
  assert.equal(isValidViewerToken(viewerToken), true);
  assert.equal(viewerTokenMatches(viewerToken, hash), true);
  assert.equal(viewerTokenMatches(`${viewerToken.slice(0, -1)}A`, hash), false);
});

test('limita formatos e constrói caminhos isolados por retoma', () => {
  const batchId = 'a'.repeat(32);

  assert.equal(normalizePhotoType('image/jpeg; charset=binary'), 'image/jpeg');
  assert.equal(normalizePhotoType('application/pdf'), '');
  assert.equal(photoPath(batchId, 1, 'image/jpeg'), `retomas/${batchId}/fotografias/01.jpg`);
  assert.equal(photoPath(batchId, 10, 'image/heic'), `retomas/${batchId}/fotografias/10.heic`);
  assert.throws(() => photoPath(batchId, 11, 'image/jpeg'));
  assert.throws(() => photoPath(batchId, 1, 'application/pdf'));
  assert.equal(MAX_PHOTO_BYTES, 10 * 1024 * 1024);
});

test('considera expiradas sessões antigas ou sem data válida', () => {
  const recent = { createdAt: new Date().toISOString() };
  const old = { createdAt: '2020-01-01T00:00:00.000Z' };

  assert.equal(sessionHasExpired(recent), false);
  assert.equal(sessionHasExpired(old), true);
  assert.equal(sessionHasExpired({}), true);
});
