import { issueSignedToken, presignUrl } from '@vercel/blob';
import { loadAuthorizedUploadManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  UPLOAD_URL_WINDOW_MS,
  blobStorageConfigured,
  noStoreHeaders,
  normalizePhotoType,
  photoPath,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

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
    const uploadToken = String(body?.uploadToken || '');
    const contentType = normalizePhotoType(body?.contentType);
    const size = Number(body?.size);
    const index = Number(body?.index);

    if (!contentType || !Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES ||
        !Number.isInteger(index) || index < 1 || index > MAX_PHOTOS) {
      return res.status(400).json({ error: 'A fotografia tem um formato ou tamanho inválido.' });
    }

    const manifest = await loadAuthorizedUploadManifest(batchId, uploadToken);
    if (!manifest) return res.status(403).json({ code: 'photo_session_closed', error: 'Este envio terminou ou expirou. Já não pode adicionar fotografias.' });

    const pathname = photoPath(batchId, index, contentType);
    const validUntil = Math.min(Date.now() + UPLOAD_URL_WINDOW_MS, Date.parse(manifest.uploadExpiresAt));
    const signedToken = await issueSignedToken({
      pathname,
      operations: ['put'],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: size
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      operation: 'put',
      pathname,
      access: 'private',
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: size,
      addRandomSuffix: false,
      allowOverwrite: false
    });

    return res.status(200).json({ uploadUrl: presignedUrl, pathname, validUntil });
  } catch (error) {
    console.error('photo_authorization_failed', error?.name || 'Error');
    return res.status(500).json({ error: 'Não foi possível autorizar esta fotografia.' });
  }
}
