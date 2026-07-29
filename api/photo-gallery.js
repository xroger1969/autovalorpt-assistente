import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import { loadAuthorizedPhotoManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTOS,
  blobStorageConfigured,
  noStoreHeaders,
  photoPrefix
} from '../lib/photo-security.js';

const VIEW_WINDOW_MS = 20 * 60 * 1000;

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!blobStorageConfigured()) {
    return res.status(503).json({
      code: 'storage_not_configured',
      error: 'O arquivo de fotografias ainda não está ligado.'
    });
  }

  try {
    const batchId = String(req.query?.batch || '');
    const viewerToken = String(req.query?.token || '');
    const manifest = await loadAuthorizedPhotoManifest(batchId, viewerToken);
    if (!manifest) return res.status(403).json({ error: 'Este acesso já não é válido.' });

    const result = await list({ prefix: photoPrefix(batchId), limit: MAX_PHOTOS + 2 });
    const blobs = (result?.blobs || [])
      .filter((blob) => blob?.pathname)
      .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
      .slice(0, MAX_PHOTOS);
    const validUntil = Date.now() + VIEW_WINDOW_MS;

    const photos = await Promise.all(blobs.map(async (blob, position) => {
      const signedToken = await issueSignedToken({
        pathname: blob.pathname,
        operations: ['get'],
        validUntil
      });
      const { presignedUrl } = await presignUrl(signedToken, {
        operation: 'get',
        pathname: blob.pathname,
        access: 'private',
        validUntil
      });
      return {
        position: position + 1,
        pathname: blob.pathname,
        contentType: blob.contentType || 'application/octet-stream',
        size: Number(blob.size || 0),
        uploadedAt: blob.uploadedAt || null,
        url: presignedUrl
      };
    }));

    return res.status(200).json({
      batchId,
      createdAt: manifest.createdAt,
      vehicle: manifest.vehicle,
      tradeIn: manifest.tradeIn,
      maxPhotos: manifest.maxPhotos || MAX_PHOTOS,
      photos,
      urlsValidUntil: validUntil
    });
  } catch (error) {
    console.error('Falha ao abrir galeria de fotografias', error?.message);
    return res.status(500).json({ error: 'Não foi possível abrir as fotografias.' });
  }
}
