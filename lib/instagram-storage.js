import { BlobPreconditionFailedError } from '@vercel/blob';

export const instagramStorageConflict = (error) => error instanceof BlobPreconditionFailedError ||
  /Precondition|AlreadyExists/.test(error?.name || '') || [409, 412].includes(error?.status);

// Download validators can be weakened by HTTP compression. Bind the downloaded
// snapshot to the storage API's strong ETag before using it for a conditional
// write. Never replace a mismatching snapshot's version with a newer one.
export async function readInstagramBlob(storage, path, timeout = 8000) {
  const abortSignal = AbortSignal.timeout(timeout);
  const result = await storage.get(path, { access: 'private', useCache: false,
    headers: { 'Accept-Encoding': 'identity' }, abortSignal });
  if (!result || result.statusCode !== 200 || !result.blob?.etag) return result;
  const metadata = await storage.head(path, { abortSignal });
  if (!metadata.etag || metadata.etag.startsWith('W/') ||
      result.blob.etag.replace(/^W\//, '') !== metadata.etag) {
    await result.stream?.cancel().catch(() => {});
    throw Object.assign(new Error('blob_read_version_changed'), { code: 'blob_read_version_changed' });
  }
  return { ...result, blob: { ...result.blob, etag: metadata.etag } };
}
