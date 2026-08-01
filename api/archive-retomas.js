import { del, issueSignedToken, list, presignUrl } from '@vercel/blob';
import { verifyArchiveAccessToken } from '../lib/archive-auth.js';
import { loadPhotoManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTOS,
  SESSION_LIFETIME_MS,
  blobStorageConfigured,
  isValidBatchId,
  noStoreHeaders,
  photoPrefix,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

const VIEW_WINDOW_MS = 20 * 60 * 1000;

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

async function listArchive(res) {
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
}

async function openArchiveRetoma(res, batchId) {
  if (!isValidBatchId(batchId)) return res.status(400).json({ error: 'Identificador de retoma inválido.' });
  const manifest = await loadPhotoManifest(batchId);
  if (!manifest) return res.status(404).json({ error: 'Esta retoma já não existe no arquivo.' });

  const result = await list({ prefix: photoPrefix(batchId), limit: MAX_PHOTOS + 2 });
  const blobs = (result?.blobs || [])
    .filter((blob) => blob?.pathname)
    .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
    .slice(0, MAX_PHOTOS);
  const validUntil = Date.now() + VIEW_WINDOW_MS;

  const photos = await Promise.all(blobs.map(async (blob, position) => {
    const signedToken = await issueSignedToken({ pathname: blob.pathname, operations: ['get'], validUntil });
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
}

async function deleteArchiveRetoma(res, batchId) {
  if (!isValidBatchId(batchId)) return res.status(400).json({ error: 'Identificador de retoma inválido.' });
  const result = await list({ prefix: `retomas/${batchId}/`, limit: 50 });
  const pathnames = (result?.blobs || []).map((blob) => blob?.pathname).filter(Boolean);
  if (!pathnames.length) return res.status(404).json({ error: 'Esta retoma já não existe no arquivo.' });
  await del(pathnames);
  return res.status(200).json({ ok: true, deleted: pathnames.length, batchId });
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'O arquivo de fotografias ainda não está ligado.' });

  try {
    if (req.method === 'GET') {
      const access = String(req.query?.access || '');
      if (!verifyArchiveAccessToken(access)) return res.status(403).json({ error: 'Acesso privado inválido ou expirado.' });
      const action = String(req.query?.action || 'list');
      if (action === 'list') return listArchive(res);
      if (action === 'open') return openArchiveRetoma(res, String(req.query?.batch || ''));
      return res.status(400).json({ error: 'Operação inválida.' });
    }

    if (req.method === 'POST') {
      if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
      const body = await readJsonBody(req);
      const access = String(body?.access || '');
      if (!verifyArchiveAccessToken(access)) return res.status(403).json({ error: 'Acesso privado inválido ou expirado.' });
      const action = String(body?.action || req.query?.action || '');
      if (action === 'delete') return deleteArchiveRetoma(res, String(body?.batchId || ''));
      return res.status(400).json({ error: 'Operação inválida.' });
    }

    return res.status(405).json({ error: 'Método não suportado.' });
  } catch (error) {
    console.error('archive_retomas_failed', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível concluir a operação no arquivo de retomas.' });
  }
}
