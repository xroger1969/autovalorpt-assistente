import { put } from '@vercel/blob';
import {
  MAX_PHOTOS,
  blobStorageConfigured,
  cleanText,
  createPhotoSessionIds,
  hashViewerToken,
  manifestPath,
  noStoreHeaders,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

function requestBaseUrl(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${protocol}://${host}`;
}

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
    const vehicle = cleanText(body?.vehicle, 180);
    const tradeIn = cleanText(body?.tradeIn, 240);
    const registration = cleanText(body?.registration, 20);
    if (tradeIn.length < 8) {
      return res.status(400).json({ error: 'Complete primeiro os dados da retoma.' });
    }
    if (!registration) return res.status(400).json({ error: 'Indique primeiro a matrícula da retoma.' });

    const { batchId, viewerToken } = createPhotoSessionIds();
    const createdAt = new Date().toISOString();
    const manifest = {
      version: 1,
      batchId,
      viewerTokenHash: hashViewerToken(viewerToken),
      createdAt,
      vehicle,
      tradeIn,
      registration,
      maxPhotos: MAX_PHOTOS
    };

    await put(manifestPath(batchId), JSON.stringify(manifest), {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: 'application/json'
    });

    const query = new URLSearchParams({ batch: batchId, token: viewerToken });
    return res.status(201).json({
      batchId,
      viewerToken,
      galleryUrl: `${requestBaseUrl(req)}/fotos.html?${query.toString()}`,
      maxPhotos: MAX_PHOTOS,
      createdAt
    });
  } catch (error) {
    console.error('Falha ao criar sessão de fotografias', error?.message);
    return res.status(500).json({ error: 'Não foi possível preparar o envio das fotografias.' });
  }
}
