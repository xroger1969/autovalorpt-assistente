import { get } from '@vercel/blob';
import {
  isValidBatchId,
  isValidViewerToken,
  manifestPath,
  sessionHasExpired,
  viewerTokenMatches
} from './photo-security.js';

async function streamToText(stream) {
  if (!stream) return '';
  return new Response(stream).text();
}

export async function loadPhotoManifest(batchId = '') {
  if (!isValidBatchId(batchId)) return null;
  const result = await get(manifestPath(batchId), { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  const raw = await streamToText(result.stream);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadAuthorizedPhotoManifest(batchId = '', viewerToken = '') {
  if (!isValidBatchId(batchId) || !isValidViewerToken(viewerToken)) return null;
  const manifest = await loadPhotoManifest(batchId);
  if (!manifest || sessionHasExpired(manifest) || !viewerTokenMatches(viewerToken, manifest.viewerTokenHash)) return null;
  return manifest;
}
