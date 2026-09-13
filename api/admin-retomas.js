import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import { adminRequestAuthorized } from '../lib/admin-security.js';
import { loadPhotoManifest } from '../lib/photo-manifest.js';
import {
  MAX_PHOTOS,
  blobStorageConfigured,
  isValidBatchId,
  noStoreHeaders,
  photoPrefix,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';
import {
  agentConfiguration,
  createExampleDraft,
  getDraft,
  listDrafts,
  publishDraft,
  resolveMediaUrl,
  saveDraft,
  syncInstagramSource
} from '../lib/instagram-agent.js';

const VIEW_WINDOW_MS = 20 * 60 * 1000;
const MAX_INBOX_ITEMS = 50;
const MAX_LIST_PAGES = 10;
const MANIFEST_PATTERN = /^retomas\/([a-f0-9]{32})\/manifest\.json$/;
const PHOTO_PATTERN = /^retomas\/([a-f0-9]{32})\/fotografias\/[^/]+$/;

async function listRetomaBlobs() {
  const blobs = [];
  let cursor;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const result = await list({
      prefix: 'retomas/',
      limit: 1000,
      ...(cursor ? { cursor } : {})
    });
    blobs.push(...(result?.blobs || []));
    if (!result?.hasMore || !result?.cursor) break;
    cursor = result.cursor;
  }

  return blobs;
}

async function loadManifestsInBatches(entries) {
  const loaded = [];
  for (let offset = 0; offset < entries.length; offset += 8) {
    const group = entries.slice(offset, offset + 8);
    const manifests = await Promise.all(group.map(async ({ batchId }) => {
      try {
        return await loadPhotoManifest(batchId);
      } catch {
        return null;
      }
    }));
    loaded.push(...manifests);
  }
  return loaded;
}

async function buildInbox() {
  const blobs = await listRetomaBlobs();
  const photoCounts = new Map();

  for (const blob of blobs) {
    const match = String(blob?.pathname || '').match(PHOTO_PATTERN);
    if (!match) continue;
    photoCounts.set(match[1], (photoCounts.get(match[1]) || 0) + 1);
  }

  const manifestEntries = blobs
    .map((blob) => {
      const match = String(blob?.pathname || '').match(MANIFEST_PATTERN);
      return match ? { batchId: match[1], uploadedAt: blob.uploadedAt || null } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.uploadedAt || 0) - Date.parse(a.uploadedAt || 0))
    .slice(0, MAX_INBOX_ITEMS);

  const manifests = await loadManifestsInBatches(manifestEntries);
  const items = manifests
    .map((manifest, index) => {
      const batchId = manifestEntries[index]?.batchId || '';
      if (!manifest || !isValidBatchId(batchId)) return null;
      return {
        batchId,
        createdAt: manifest.createdAt || manifestEntries[index]?.uploadedAt || null,
        vehicle: String(manifest.vehicle || ''),
        tradeIn: String(manifest.tradeIn || ''),
        photoCount: Math.min(photoCounts.get(batchId) || 0, MAX_PHOTOS)
      };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));

  return items;
}

async function buildDetail(batchId) {
  const manifest = await loadPhotoManifest(batchId);
  if (!manifest) return null;

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
      contentType: blob.contentType || 'application/octet-stream',
      size: Number(blob.size || 0),
      uploadedAt: blob.uploadedAt || null,
      url: presignedUrl
    };
  }));

  return {
    batchId,
    createdAt: manifest.createdAt || null,
    vehicle: String(manifest.vehicle || ''),
    tradeIn: String(manifest.tradeIn || ''),
    photos,
    urlsValidUntil: validUntil
  };
}

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  return Boolean(secret && String(req?.headers?.authorization || '') === `Bearer ${secret}`);
}

function cleanCaption(value = '') {
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, 2200);
}

async function handleInstagram(req, res, action) {
  if (action === 'media') {
    if (req.method !== 'GET') return res.status(405).end('Use GET.');
    const url = await resolveMediaUrl(String(req.query?.sourceId || ''), Number(req.query?.position));
    if (!url) return res.status(404).end('Imagem não encontrada.');
    res.statusCode = 302;
    res.setHeader('Location', url);
    return res.end();
  }

  if (action === 'sync') {
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Use GET ou POST.' });
    if (!adminRequestAuthorized(req) && !cronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado.' });
    try {
      const result = await syncInstagramSource();
      return res.status(200).json({ ok: true, configuration: agentConfiguration(), ...result });
    } catch (error) {
      console.error('instagram-agent-sync', error?.code, error?.message);
      const status = ['meta_not_configured', 'storage_not_configured'].includes(error?.code) ? 503 : 500;
      return res.status(status).json({
        error: error?.message || 'Falha ao verificar o Instagram.',
        code: error?.code || 'sync_failed',
        configuration: agentConfiguration()
      });
    }
  }

  if (!adminRequestAuthorized(req)) return res.status(401).json({ error: 'Acesso privado necessário.' });

  if (action === 'drafts') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
    return res.status(200).json({ configuration: agentConfiguration(), items: await listDrafts() });
  }

  if (action === 'action') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
    if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
    const body = await readJsonBody(req, 12 * 1024);
    const requestedAction = String(body?.action || '').trim();

    if (requestedAction === 'seed') {
      return res.status(200).json({ ok: true, item: await createExampleDraft() });
    }

    const sourceId = String(body?.sourceId || '').trim();
    const draft = await getDraft(sourceId);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado.' });

    if (requestedAction === 'ignore') {
      const item = await saveDraft({ ...draft, status: 'ignored', ignoredAt: new Date().toISOString() });
      return res.status(200).json({ ok: true, item });
    }

    if (requestedAction === 'save') {
      const caption = cleanCaption(body?.caption);
      if (!caption) return res.status(400).json({ error: 'A legenda não pode ficar vazia.' });
      const item = await saveDraft({ ...draft, caption, status: draft.status === 'published' ? 'published' : 'pending' });
      return res.status(200).json({ ok: true, item });
    }

    if (requestedAction === 'publish') {
      const caption = cleanCaption(body?.caption || draft.caption);
      if (!caption) return res.status(400).json({ error: 'A legenda não pode ficar vazia.' });
      const published = await publishDraft({ ...draft, caption });
      const item = await saveDraft(published);
      return res.status(200).json({ ok: true, item });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  }

  return res.status(400).json({ error: 'Ação do agente desconhecida.' });
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');

  const instagramAction = String(req.query?.instagramAction || '');
  if (instagramAction) {
    try {
      return await handleInstagram(req, res, instagramAction);
    } catch (error) {
      console.error('instagram-agent', error?.code, error?.message);
      const status = ['meta_not_configured', 'no_media'].includes(error?.code) ? 409 : 500;
      return res.status(status).json({ error: error?.message || 'Não foi possível concluir a ação.', code: error?.code || 'agent_failed' });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!adminRequestAuthorized(req)) return res.status(401).json({ error: 'Acesso privado necessário.' });
  if (!blobStorageConfigured()) {
    return res.status(503).json({
      code: 'storage_not_configured',
      error: 'O arquivo de fotografias ainda não está ligado.'
    });
  }

  try {
    const batchId = String(req.query?.batch || '');
    if (batchId) {
      if (!isValidBatchId(batchId)) return res.status(400).json({ error: 'Retoma inválida.' });
      const detail = await buildDetail(batchId);
      if (!detail) return res.status(404).json({ error: 'Retoma não encontrada.' });
      return res.status(200).json(detail);
    }

    return res.status(200).json({ items: await buildInbox() });
  } catch (error) {
    console.error('Falha ao abrir área privada de retomas', error?.message);
    return res.status(500).json({ error: 'Não foi possível abrir as retomas.' });
  }
}
