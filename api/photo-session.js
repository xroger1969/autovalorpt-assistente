import { put } from '@vercel/blob';
import {
  MAX_PHOTOS,
  UPLOAD_LIFETIME_MS,
  blobStorageConfigured,
  cleanText,
  createPhotoSessionIds,
  hashViewerToken,
  manifestPath,
  noStoreHeaders,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

const sessionAttempts = new Map();
function rateLimited(req) {
  const now = Date.now();
  const key = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  for (const [ip, entry] of sessionAttempts) if (now >= entry.resetAt) sessionAttempts.delete(ip);
  const entry = sessionAttempts.get(key) || { count: 0, resetAt: now + 60 * 60 * 1000 };
  entry.count += 1;
  if (sessionAttempts.size >= 10000 && !sessionAttempts.has(key)) return true;
  sessionAttempts.set(key, entry);
  return entry.count > 12;
}

function requestBaseUrl(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${protocol}://${host}`;
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
  if (rateLimited(req)) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ error: 'Foram iniciados demasiados envios. Tente novamente mais tarde.' });
  }
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

    const { batchId, viewerToken, uploadToken } = createPhotoSessionIds();
    const createdAt = new Date().toISOString();
    const uploadExpiresAt = new Date(Date.now() + UPLOAD_LIFETIME_MS).toISOString();
    const manifest = {
      version: 2,
      batchId,
      viewerTokenHash: hashViewerToken(viewerToken),
      uploadTokenHash: hashViewerToken(uploadToken),
      uploadExpiresAt,
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
      uploadToken,
      uploadExpiresAt,
      galleryUrl: `${requestBaseUrl(req)}/fotos.html?${query.toString()}`,
      maxPhotos: MAX_PHOTOS,
      createdAt
    });
  } catch (error) {
    console.error('photo_session_failed', error?.name || 'Error');
    return res.status(500).json({ error: 'Não foi possível preparar o envio das fotografias.' });
  }
}
