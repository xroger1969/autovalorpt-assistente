import { list } from '@vercel/blob';
import { verifyArchiveAccessToken } from '../lib/archive-auth.js';
import { loadPhotoManifest } from '../lib/photo-manifest.js';
import { SESSION_LIFETIME_MS, blobStorageConfigured, noStoreHeaders } from '../lib/photo-security.js';

async function listAllRetomaBlobs() {
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'retomas/', limit: 1000, ...(cursor ? { cursor } : {}) });
    blobs.push(...(page?.blobs || []));
    cursor = page?.hasMore ? page?.cursor : undefined;
  } while (cursor && blobs.length < 10000);
  return blobs;
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  const access = String(req.query?.access || '');
  if (!verifyArchiveAccessToken(access)) return res.status(403).json({ error: 'Acesso privado inválido ou expirado.' });
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'O arquivo de fotografias ainda não está ligado.' });

  try {
    const blobs = await listAllRetomaBlobs();
    const photoCounts = new Map();
    const photoBytes = new Map();
    const batchIds = new Set();

    for (const blob of blobs) {
      const pathname = String(blob?.pathname || '');
      const manifestMatch = pathname.match(/^retomas\/([a-f0-9]{32})\/manifest\.json$/);
      if (manifestMatch) batchIds.add(manifestMatch[1]);
      const photoMatch = pathname.match(/^retomas\/([a-f0-9]{32})\/fotografias\//);
      if (photoMatch) {
        const id = photoMatch[1];
        photoCounts.set(id, (photoCounts.get(id) || 0) + 1);
        photoBytes.set(id, (photoBytes.get(id) || 0) + Number(blob?.size || 0));
      }
    }

    const items = (await Promise.all([...batchIds].map(async (batchId) => {
      const manifest = await loadPhotoManifest(batchId);
      if (!manifest) return null;
      const createdAt = String(manifest.createdAt || '');
      const createdMs = Date.parse(createdAt);
      const expiresAt = Number.isFinite(createdMs) ? new Date(createdMs + SESSION_LIFETIME_MS).toISOString() : null;
      return {
        batchId,
        createdAt,
        expiresAt,
        expired: Number.isFinite(createdMs) ? Date.now() - createdMs > SESSION_LIFETIME_MS : true,
        vehicle: String(manifest.vehicle || ''),
        tradeIn: String(manifest.tradeIn || ''),
        photoCount: photoCounts.get(batchId) || 0,
        totalBytes: photoBytes.get(batchId) || 0
      };
    }))).filter(Boolean);

    items.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    console.error('archive_retomas_list_failed', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível carregar o arquivo de retomas.' });
  }
}
