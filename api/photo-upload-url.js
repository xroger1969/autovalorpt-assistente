import { issueSignedToken, presignUrl } from '@vercel/blob';
import { loadAuthorizedPhotoManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTO_BYTES,
  blobStorageConfigured,
  noStoreHeaders,
  normalizePhotoType,
  photoPath,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
  if (!blobStorageConfigured()) {
    return res.status(503).json({
      code: 'storage_not_configured',
      error: 'O envio de fotografias ainda não está ligado.'
    });
  }

  try {
    const body = await readJsonBody(req);
    const batchId = String(body?.batchId || '');
    const viewerToken = String(body?.viewerToken || '');
    const contentType = normalizePhotoType(body?.contentType);
    const size = Number(body?.size);
    const index = Number(body?.index);

    if (!contentType || !Number.isFinite(size) || size < 1 || size > MAX_PHOTO_BYTES) {
      return res.status(400).json({ error: 'A fotografia tem um formato ou tamanho inválido.' });
    }

    const manifest = await loadAuthorizedPhotoManifest(batchId, viewerToken);
    if (!manifest) return res.status(403).json({ error: 'Este envio já não é válido.' });

    const pathname = photoPath(batchId, index, contentType);
    const validUntil = Date.now() + UPLOAD_WINDOW_MS;
    const signedToken = await issueSignedToken({
      pathname,
      operations: ['put'],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_PHOTO_BYTES
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: 'put',
      pathname,
      access: 'private',
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_PHOTO_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false
    });

    return res.status(200).json({ uploadUrl: presignedUrl, pathname, validUntil });
  } catch (error) {
    console.error('Falha ao autorizar fotografia', error?.message);
    return res.status(500).json({ error: 'Não foi possível autorizar esta fotografia.' });
  }
}
