import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoRepository } from '../lib/photo-manifest.js';
import { createPhotoSessionIds, hashViewerToken, manifestPath, photoPath, UPLOAD_LIFETIME_MS } from '../lib/photo-security.js';

function fixture() {
  const ids = createPhotoSessionIds();
  const manifest = {
    version: 2, batchId: ids.batchId,
    createdAt: new Date().toISOString(),
    uploadExpiresAt: new Date(Date.now() + UPLOAD_LIFETIME_MS).toISOString(),
    viewerTokenHash: hashViewerToken(ids.viewerToken),
    uploadTokenHash: hashViewerToken(ids.uploadToken)
  };
  const records = new Map([[manifestPath(ids.batchId), JSON.stringify(manifest)]]);
  const photos = [{ pathname: photoPath(ids.batchId, 1, 'image/jpeg'), size: 1234 }];
  const storage = {
    async get(path, options) {
      assert.equal(options.access, 'private');
      assert.equal(options.useCache, false);
      return records.has(path) ? { statusCode: 200, stream: new Response(records.get(path)).body } : null;
    },
    async list({ prefix }) { return { blobs: photos.filter((photo) => photo.pathname.startsWith(prefix)) }; },
    async put(path, value, options) {
      assert.equal(options.access, 'private');
      assert.equal(options.allowOverwrite, false);
      assert.equal(options.addRandomSuffix, false);
      if (records.has(path)) throw new Error('Already exists');
      records.set(path, value);
      return { pathname: path };
    }
  };
  return { ids, manifest, records, photos, repo: createPhotoRepository(storage) };
}

test('token de galeria mantém leitura mas nunca autoriza escrita ou associação', async () => {
  const { repo, ids } = fixture();
  assert.ok(await repo.loadAuthorizedPhotoManifest(ids.batchId, ids.viewerToken));
  assert.equal(await repo.loadAuthorizedUploadManifest(ids.batchId, ids.viewerToken), null);
  assert.ok(await repo.loadAuthorizedUploadManifest(ids.batchId, ids.uploadToken));
  await assert.rejects(
    repo.attachPhotoSessionToLead({ batchId: ids.batchId, uploadToken: ids.viewerToken }, 'a'.repeat(32)),
    { code: 'invalid_photo_session' }
  );
});

test('associa fotografias ao pedido e impede novas autorizações de escrita', async () => {
  const { repo, ids, photos } = fixture();
  const attachment = await repo.attachPhotoSessionToLead({ ...ids, count: 1 }, 'a'.repeat(32));
  assert.equal(attachment.count, 1);
  assert.deepEqual(attachment.paths, [photos[0].pathname]);
  assert.equal(attachment.uploadToken, undefined);
  assert.equal(attachment.viewerToken, undefined);
  assert.equal(await repo.loadAuthorizedUploadManifest(ids.batchId, ids.uploadToken), null);
  assert.ok(await repo.loadAuthorizedPhotoManifest(ids.batchId, ids.viewerToken));
  assert.deepEqual(await repo.attachPhotoSessionToLead({ ...ids, count: 1 }, 'a'.repeat(32)), attachment);
  await assert.rejects(repo.attachPhotoSessionToLead(ids, 'b'.repeat(32)), { code: 'photos_already_attached' });
});

test('uma corrida entre dois pedidos só permite uma associação', async () => {
  const { repo, ids } = fixture();
  const results = await Promise.allSettled([
    repo.attachPhotoSessionToLead(ids, 'a'.repeat(32)),
    repo.attachPhotoSessionToLead(ids, 'b'.repeat(32))
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected')[0].reason.code, 'photos_already_attached');
});

test('um PUT previamente autorizado que chegue tarde não altera o pedido fechado', async () => {
  const { repo, ids, manifest, photos } = fixture();
  await repo.attachPhotoSessionToLead({ ...ids, count: 1 }, 'a'.repeat(32));
  photos.push({ pathname: photoPath(ids.batchId, 2, 'image/png'), size: 1200 });
  const visible = await repo.listPhotoBlobs(manifest);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].pathname, photos[0].pathname);
  assert.equal((await repo.attachPhotoSessionToLead(ids, 'a'.repeat(32))).count, 1);
});

test('não perde silenciosamente fotografias ainda por confirmar e não confia na contagem do cliente', async () => {
  const { repo, ids } = fixture();
  await assert.rejects(repo.attachPhotoSessionToLead({ ...ids, count: 2 }, 'a'.repeat(32)), { code: 'photos_not_ready' });
  assert.equal((await repo.attachPhotoSessionToLead({ ...ids, count: 0 }, 'a'.repeat(32))).count, 1);
});

test('sessões antigas continuam legíveis mas ficam sem autorização de escrita', async () => {
  const { repo, ids, manifest, records, photos } = fixture();
  const legacy = { ...manifest, version: 1 };
  delete legacy.uploadTokenHash;
  records.set(manifestPath(ids.batchId), JSON.stringify(legacy));
  photos[0].pathname += '.jpg';
  assert.ok(await repo.loadAuthorizedPhotoManifest(ids.batchId, ids.viewerToken));
  assert.equal(await repo.loadAuthorizedUploadManifest(ids.batchId, ids.uploadToken), null);
  assert.equal((await repo.listPhotoBlobs(legacy)).length, 1);
});
