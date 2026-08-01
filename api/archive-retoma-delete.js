import { del, list } from '@vercel/blob';
import { verifyArchiveAccessToken } from '../lib/archive-auth.js';
import {
  blobStorageConfigured,
  isValidBatchId,
  noStoreHeaders,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
  if (!blobStorageConfigured()) return res.status(503).json({ error: 'O arquivo de fotografias ainda não está ligado.' });

  try {
    const body = await readJsonBody(req);
    const access = String(body?.access || '');
    const batchId = String(body?.batchId || '');
    if (!verifyArchiveAccessToken(access)) return res.status(403).json({ error: 'Acesso privado inválido ou expirado.' });
    if (!isValidBatchId(batchId)) return res.status(400).json({ error: 'Identificador de retoma inválido.' });

    const result = await list({ prefix: `retomas/${batchId}/`, limit: 50 });
    const pathnames = (result?.blobs || []).map((blob) => blob?.pathname).filter(Boolean);
    if (!pathnames.length) return res.status(404).json({ error: 'Esta retoma já não existe no arquivo.' });

    await del(pathnames);
    return res.status(200).json({ ok: true, deleted: pathnames.length, batchId });
  } catch (error) {
    console.error('archive_retoma_delete_failed', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível eliminar esta retoma.' });
  }
}
