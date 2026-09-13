import { issueSignedToken, list, presignUrl, put } from '@vercel/blob';

const ROOT = 'instagram-agent';
const DRAFT_PREFIX = `${ROOT}/drafts/`;
const MEDIA_PREFIX = `${ROOT}/media/`;
const DEFAULT_SOURCE = 'samucar_stand';
const DEFAULT_GRAPH_VERSION = 'v24.0';
const DEFAULT_PUBLIC_BASE_URL = 'https://autovalorpt-assistente.vercel.app';
const MAX_SOURCE_POSTS = 12;
const MAX_MEDIA_ITEMS = 10;
const READ_WINDOW_MS = 10 * 60 * 1000;

export function sourceUsername() {
  return String(process.env.INSTAGRAM_SOURCE_USERNAME || DEFAULT_SOURCE).replace(/^@/, '').trim();
}

export function targetInstagramUserId() {
  return String(process.env.AUTOVALOR_IG_USER_ID || '').trim();
}

export function publicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/$/, '');
}

export function metaConfigured() {
  return Boolean(String(process.env.META_ACCESS_TOKEN || '').trim() && targetInstagramUserId());
}

export function blobConfigured() {
  return Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim());
}

export function agentConfiguration() {
  return {
    source: sourceUsername(),
    target: 'autovalorpt',
    metaConfigured: metaConfigured(),
    storageConfigured: blobConfigured(),
    graphVersion: String(process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION)
  };
}

function safeId(value = '') {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120);
}

function cleanLine(value = '') {
  return String(value)
    .replace(/[➡️▶️➜➤]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEdgeEmoji(value = '') {
  return String(value)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N})]+$/u, '')
    .trim();
}

function firstMatch(lines, patterns) {
  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) return line;
  }
  return '';
}

export function adaptSourceCaption(sourceCaption = '') {
  const source = sourceUsername().toLowerCase();
  const rawLines = String(sourceCaption || '')
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (lower.includes(source)) return false;
      if (lower.includes('samucar.pt')) return false;
      if (lower.includes('tratamos do processo de financiamento')) return false;
      if (lower.includes('consultar condições comerciais')) return false;
      if (lower.includes('despesas administrativas')) return false;
      if (lower.includes('intermediários de crédito')) return false;
      if (lower.includes('intermediarios de credito')) return false;
      if (/^aut\s*\d+/i.test(line)) return false;
      return true;
    });

  const title = stripEdgeEmoji(rawLines[0] || 'Viatura disponível').toUpperCase();
  const year = firstMatch(rawLines, [/\b20\d{2}\b.*\bNACIONAL\b/i, /^20\d{2}\b/i]);
  const fuel = firstMatch(rawLines, [/\b(GASOLINA|DIESEL|EL[EÉ]TRIC[OA]|H[IÍ]BRID[OA]|GPL)\b/i]);
  const power = firstMatch(rawLines, [/\b\d(?:[.,]\d)?\s*(?:cc)?\s*(?:de)?\s*\d{2,4}\s*cv\b/i, /\b\d{2,4}\s*cv\b/i]);
  const price = firstMatch(rawLines, [/\b\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})?\s*€\b/i]);
  const kilometres = firstMatch(rawLines, [/\b\d{1,3}(?:[.\s]\d{3})+\s*km\b/i, /\b\d+\s*km\b/i]);

  const details = [];
  if (year) details.push(`✅ ${year}`);
  if (fuel) details.push(`⛽ ${fuel}`);
  if (power) details.push(`⚙️ ${power}`);
  if (kilometres) details.push(`📍 ${kilometres}`);
  if (price) details.push(`💶 ${price}`);

  return [
    `🚘 ${title}`,
    '',
    ...details,
    '',
    '💳 Financiamento disponível mediante aprovação.',
    '🔄 Retomas sob avaliação.',
    '',
    '📩 Para mais informações, envia mensagem à AutoValorPT.',
    '',
    '#AutoValorPT #Automoveis #Usados'
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function graphJson(path, { method = 'GET', params = {} } = {}) {
  const token = String(process.env.META_ACCESS_TOKEN || '').trim();
  if (!token) throw Object.assign(new Error('META_ACCESS_TOKEN em falta.'), { code: 'meta_not_configured' });

  const graphVersion = String(process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION);
  const base = `https://graph.facebook.com/${graphVersion}/${String(path).replace(/^\//, '')}`;
  const url = new URL(base);
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25000)
  };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  } else {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    init.body = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
  }

  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Meta devolveu HTTP ${response.status}.`;
    throw Object.assign(new Error(message), { code: 'meta_error', details: data?.error || null });
  }
  return data;
}

function mediaItemsFromSource(post = {}) {
  if (post.media_type === 'CAROUSEL_ALBUM') {
    return (post.children?.data || [])
      .filter((item) => item?.media_type === 'IMAGE' && item?.media_url)
      .slice(0, MAX_MEDIA_ITEMS)
      .map((item) => ({ type: 'IMAGE', sourceUrl: item.media_url }));
  }
  if (post.media_type === 'IMAGE' && post.media_url) {
    return [{ type: 'IMAGE', sourceUrl: post.media_url }];
  }
  return [];
}

function extensionFor(contentType = '') {
  const type = String(contentType).toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  return 'jpg';
}

async function privateReadUrl(pathname, validForMs = READ_WINDOW_MS) {
  const validUntil = Date.now() + validForMs;
  const signedToken = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: 'get',
    pathname,
    access: 'private',
    validUntil
  });
  return presignedUrl;
}

async function copyImageToBlob(sourceId, item, position) {
  const response = await fetch(item.sourceUrl, {
    headers: { 'User-Agent': 'AutoValorPT-Instagram-Agent/1.0' },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Não foi possível copiar a fotografia ${position + 1}.`);

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) throw new Error('O conteúdo recebido não é uma imagem.');
  const body = await response.arrayBuffer();
  const pathname = `${MEDIA_PREFIX}${safeId(sourceId)}/${String(position + 1).padStart(2, '0')}.${extensionFor(contentType)}`;
  const blob = await put(pathname, body, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true
  });
  return { type: 'IMAGE', pathname: blob.pathname, position };
}

async function writeDraft(draft) {
  if (!blobConfigured()) throw Object.assign(new Error('Vercel Blob não configurado.'), { code: 'storage_not_configured' });
  const id = safeId(draft?.sourceId);
  if (!id) throw new Error('Identificador inválido.');
  const version = Date.now();
  const pathname = `${DRAFT_PREFIX}${id}/${version}.json`;
  const updatedAt = new Date().toISOString();
  await put(pathname, JSON.stringify({ ...draft, updatedAt }), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false
  });
  return { ...draft, updatedAt };
}

async function readBlobJson(pathname) {
  const url = await privateReadUrl(pathname);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export async function listDrafts() {
  if (!blobConfigured()) return [];
  const result = await list({ prefix: DRAFT_PREFIX, limit: 500 });
  const latest = new Map();
  for (const blob of result?.blobs || []) {
    const match = String(blob.pathname || '').match(/^instagram-agent\/drafts\/([A-Za-z0-9_-]+)\/(\d+)\.json$/);
    if (!match) continue;
    const previous = latest.get(match[1]);
    if (!previous || Number(match[2]) > previous.version) {
      latest.set(match[1], { version: Number(match[2]), pathname: blob.pathname });
    }
  }

  const items = [];
  for (const entry of latest.values()) {
    const draft = await readBlobJson(entry.pathname);
    if (draft) items.push(draft);
  }
  return items.sort((a, b) => Date.parse(b.sourceTimestamp || b.createdAt || 0) - Date.parse(a.sourceTimestamp || a.createdAt || 0));
}

export async function getDraft(sourceId) {
  const id = safeId(sourceId);
  if (!id || !blobConfigured()) return null;
  const result = await list({ prefix: `${DRAFT_PREFIX}${id}/`, limit: 100 });
  const newest = (result?.blobs || [])
    .map((blob) => {
      const match = String(blob.pathname || '').match(/\/(\d+)\.json$/);
      return match ? { version: Number(match[1]), pathname: blob.pathname } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.version - a.version)[0];
  return newest ? readBlobJson(newest.pathname) : null;
}

export async function resolveMediaUrl(sourceId, position) {
  const id = safeId(sourceId);
  const index = Number(position);
  if (!id || !Number.isInteger(index) || index < 0 || index >= MAX_MEDIA_ITEMS || !blobConfigured()) return null;
  const result = await list({ prefix: `${MEDIA_PREFIX}${id}/`, limit: MAX_MEDIA_ITEMS + 2 });
  const items = (result?.blobs || []).filter((blob) => blob?.pathname).sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)));
  const blob = items[index];
  if (!blob) return null;
  return privateReadUrl(blob.pathname, 5 * 60 * 1000);
}

export async function saveDraft(draft) {
  return writeDraft(draft);
}

export async function createExampleDraft() {
  const sourceId = 'demo-ranger-DdMDgj2CCcb';
  const existing = await getDraft(sourceId);
  if (existing) return existing;
  return writeDraft({
    sourceId,
    sourceUsername: sourceUsername(),
    sourcePermalink: 'https://www.instagram.com/p/DdMDgj2CCcb/',
    sourceTimestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: 'pending',
    isExample: true,
    media: [],
    sourceCaption: 'FORD RANGER RAPTOR\n2023 NACIONAL\nGASOLINA\n3.0 cc de 292 cv\n62.990€\n78.000 km',
    caption: adaptSourceCaption('FORD RANGER RAPTOR\n2023 NACIONAL\nGASOLINA\n3.0 cc de 292 cv\n62.990€\n78.000 km')
  });
}

export async function syncInstagramSource() {
  if (!metaConfigured()) throw Object.assign(new Error('Ligação à Meta ainda não configurada.'), { code: 'meta_not_configured' });
  if (!blobConfigured()) throw Object.assign(new Error('Vercel Blob ainda não configurado.'), { code: 'storage_not_configured' });

  const source = sourceUsername();
  const targetId = targetInstagramUserId();
  const fields = `business_discovery.username(${source}){id,username,name,media.limit(${MAX_SOURCE_POSTS}){id,caption,media_type,media_url,permalink,timestamp,children{media_type,media_url}}}`;
  const response = await graphJson(targetId, { params: { fields } });
  const posts = response?.business_discovery?.media?.data || [];
  const current = await listDrafts();
  const known = new Set(current.map((item) => String(item.sourceId)));
  const created = [];

  for (const post of [...posts].reverse()) {
    const sourceId = safeId(post?.id);
    if (!sourceId || known.has(sourceId)) continue;
    const sourceMedia = mediaItemsFromSource(post);
    const copiedMedia = [];
    for (let i = 0; i < sourceMedia.length; i += 1) {
      copiedMedia.push(await copyImageToBlob(sourceId, sourceMedia[i], i));
    }

    const draft = {
      sourceId,
      sourceUsername: source,
      sourcePermalink: String(post?.permalink || ''),
      sourceTimestamp: post?.timestamp || new Date().toISOString(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      sourceMediaType: String(post?.media_type || ''),
      unsupportedMedia: sourceMedia.length === 0,
      media: copiedMedia,
      sourceCaption: String(post?.caption || ''),
      caption: adaptSourceCaption(post?.caption || '')
    };
    await writeDraft(draft);
    created.push(draft);
    known.add(sourceId);
  }

  return { checked: posts.length, created };
}

async function createContainer(params) {
  const targetId = targetInstagramUserId();
  return graphJson(`${targetId}/media`, { method: 'POST', params });
}

async function publishContainer(creationId) {
  const targetId = targetInstagramUserId();
  return graphJson(`${targetId}/media_publish`, { method: 'POST', params: { creation_id: creationId } });
}

export async function publishDraft(draft) {
  if (!metaConfigured()) throw Object.assign(new Error('Ligação à Meta ainda não configurada.'), { code: 'meta_not_configured' });
  const media = Array.isArray(draft?.media) ? draft.media.filter((item) => item?.type === 'IMAGE' && item?.pathname).slice(0, MAX_MEDIA_ITEMS) : [];
  if (!media.length) throw Object.assign(new Error('Este rascunho ainda não tem fotografias publicáveis.'), { code: 'no_media' });

  const sourceId = safeId(draft.sourceId);
  const imageUrl = (index) => `${publicBaseUrl()}/api/instagram-agent-media?sourceId=${encodeURIComponent(sourceId)}&position=${index}`;

  let creationId;
  if (media.length === 1) {
    const created = await createContainer({ image_url: imageUrl(0), caption: String(draft.caption || '') });
    creationId = created.id;
  } else {
    const children = [];
    for (let i = 0; i < media.length; i += 1) {
      const child = await createContainer({ image_url: imageUrl(i), is_carousel_item: 'true' });
      children.push(child.id);
    }
    const parent = await createContainer({ media_type: 'CAROUSEL', children: children.join(','), caption: String(draft.caption || '') });
    creationId = parent.id;
  }

  const published = await publishContainer(creationId);
  return {
    ...draft,
    status: 'published',
    publishedAt: new Date().toISOString(),
    targetMediaId: String(published?.id || '')
  };
}
