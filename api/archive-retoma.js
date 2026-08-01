import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import { verifyArchiveAccessToken } from '../lib/archive-auth.js';
import { loadPhotoManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTOS,
  blobStorageConfigured,
  isValidBatchId,
  noStoreHeaders,
  photoPrefix
} from '../lib/photo-security.js';

const VIEW_WINDOW_MS = 20 * 60 * 1000;

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  const access = String(req.query?.access || '');
  const batchId = String(req.query?.batch || '');
  if (!verifyArchiveAccessToken(access)) return res.status(403).json({ error: 'Acesso privado inválido ou expirado.' });
  if (!isValidBatchId(batchId)) return res.status(400).json({ error: 'Identificador de retoma inválido.' });
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'O arquivo de fotografias ainda não está ligado.' });

  try {
    const manifest = await loadPhotoManifest(batchId);
    if (!manifest) return res.status(404).json({ error: 'Esta retoma já não existe no arquivo.' });

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
      vehicle: manifest.vehicle || '',
      tradeIn: manifest.tradeIn || '',
      photos,
      urlsValidUntil: validUntil
    });
  } catch (error) {
    console.error('archive_retoma_open_failed', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível abrir esta retoma.' });
  }
}
