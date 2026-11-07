import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict } from '../lib/instagram-storage.js';

test('compressed download validator is bound to a matching strong storage version', async () => {
  const storage = {
    async get(path, options) {
      assert.equal(options.useCache, false);
      assert.equal(options.headers['Accept-Encoding'], 'identity');
      return { statusCode: 200, stream: new Response('{}').body, blob: { etag: 'W/"version1"' } };
    },
    async head() { return { etag: '"version1"' }; },
  };
  assert.equal((await readInstagramBlob(storage, 'state.json')).blob.etag, '"version1"');
});

test('a concurrent change cannot attach a newer version to an old snapshot', async () => {
  let canceled = false;
  const storage = {
    async get() { return { statusCode: 200, blob: { etag: 'W/"old"' }, stream: { cancel: async () => { canceled = true; } } }; },
    async head() { return { etag: '"new"' }; },
  };
  await assert.rejects(readInstagramBlob(storage, 'state.json'), { code: 'blob_read_version_changed' });
  assert.equal(canceled, true);
});

test('missing blobs remain missing and do not trigger metadata reads', async () => {
  assert.equal(await readInstagramBlob({ get: async () => null, head: async () => { assert.fail(); } }, 'new.json'), null);
});

test('the real SDK precondition error is recognized despite its generic Error name', () => {
  const error = new BlobPreconditionFailedError();
  assert.equal(error.name, 'Error');
  assert.equal(instagramStorageConflict(error), true);
  assert.equal(instagramStorageConflict(new Error('unrelated failure')), false);
});
