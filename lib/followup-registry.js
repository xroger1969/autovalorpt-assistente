import crypto from 'node:crypto';
import { get, list, put } from '@vercel/blob';
import { blobStorageConfigured, cleanText } from './photo-security.js';

export const FOLLOWUP_LEAD_PREFIX = 'followups/leads/';
const MAX_LISTED_LEADS = 500;

function asIso(value, fallback = null) {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

async function streamToJson(stream) {
  if (!stream) return null;
  try {
    const raw = await new Response(stream).text();
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function normalizeLeadPhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `351${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? digits : '';
}

export function createFollowUpLeadId(input = {}) {
  const phone = normalizeLeadPhone(input.phone || input.contact || input.telefone);
  const vehicle = cleanText(input.vehicle || input.viatura, 180).toLocaleLowerCase('pt-PT');
  if (!phone || !vehicle) return '';
  return crypto.createHash('sha256').update(`${phone}|${vehicle}`).digest('hex').slice(0, 32);
}

export function followUpLeadPath(id = '') {
  if (!/^[a-f0-9]{32}$/.test(String(id))) throw new Error('Identificador de lead inválido.');
  return `${FOLLOWUP_LEAD_PREFIX}${id}.json`;
}

function cleanFollowupsSent(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const stage = Number(typeof entry === 'object' ? entry?.stage : entry);
      if (![1, 2, 3].includes(stage)) return null;
      const sentAt = typeof entry === 'object' ? asIso(entry?.sentAt) : null;
      return sentAt ? { stage, sentAt } : { stage };
    })
    .filter(Boolean)
    .slice(0, 3);
}

export function normalizeFollowUpLead(input = {}, now = new Date()) {
  const timestamp = asIso(now, new Date().toISOString());
  const phone = normalizeLeadPhone(input.phone || input.contact || input.telefone);
  const name = cleanText(input.name || input.nome, 120);
  const vehicle = cleanText(input.vehicle || input.viatura, 180);
  const id = createFollowUpLeadId({ phone, vehicle });

  if (!id || !name || !phone || !vehicle) return null;

  return {
    version: 1,
    id,
    source: cleanText(input.source || 'autovalorpt-assistente', 80),
    name,
    phone,
    vehicle,
    vehicleUrl: cleanText(input.vehicleUrl || input.anuncio || input['anúncio'], 500),
    subjects: cleanText(input.subjects || input.assuntos, 300),
    financing: cleanText(input.financing || input.financiamento, 220),
    tradeIn: cleanText(input.tradeIn || input.retoma, 300),
    visit: cleanText(input.visit || input.visita, 180),
    observations: cleanText(input.observations || input.observacoes || input['observações'], 500),
    status: cleanText(input.status || 'open', 40).toLowerCase(),
    vehicleStatus: cleanText(input.vehicleStatus || 'available', 40).toLowerCase(),
    canContact: input.canContact !== false,
    optedOut: input.optedOut === true,
    doNotContact: input.doNotContact === true,
    sequenceStartedAt: asIso(input.sequenceStartedAt, timestamp),
    lastInboundAt: asIso(input.lastInboundAt),
    followupsSent: cleanFollowupsSent(input.followupsSent),
    createdAt: asIso(input.createdAt, timestamp),
    updatedAt: timestamp
  };
}

export function mergeFollowUpLeadRecords(existing = null, incoming = null, now = new Date()) {
  if (!incoming) return existing || null;
  if (!existing) return { ...incoming, updatedAt: asIso(now, incoming.updatedAt) };

  const existingInbound = asIso(existing.lastInboundAt);
  const incomingInbound = asIso(incoming.lastInboundAt);
  const lastInboundAt = [existingInbound, incomingInbound]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;

  return {
    ...existing,
    name: incoming.name || existing.name,
    phone: incoming.phone || existing.phone,
    vehicle: incoming.vehicle || existing.vehicle,
    vehicleUrl: incoming.vehicleUrl || existing.vehicleUrl || '',
    subjects: incoming.subjects || existing.subjects || '',
    financing: incoming.financing || existing.financing || '',
    tradeIn: incoming.tradeIn || existing.tradeIn || '',
    visit: incoming.visit || existing.visit || '',
    observations: incoming.observations || existing.observations || '',
    source: incoming.source || existing.source,
    sequenceStartedAt: existing.sequenceStartedAt || incoming.sequenceStartedAt,
    lastInboundAt,
    followupsSent: Array.isArray(existing.followupsSent) ? existing.followupsSent : incoming.followupsSent,
    status: existing.status || incoming.status,
    vehicleStatus: existing.vehicleStatus || incoming.vehicleStatus,
    canContact: existing.canContact !== false && incoming.canContact !== false,
    optedOut: existing.optedOut === true || incoming.optedOut === true,
    doNotContact: existing.doNotContact === true || incoming.doNotContact === true,
    createdAt: existing.createdAt || incoming.createdAt,
    updatedAt: asIso(now, incoming.updatedAt)
  };
}

export async function loadFollowUpLead(id = '') {
  if (!blobStorageConfigured()) return null;
  const result = await get(followUpLeadPath(id), { access: 'private' });
  if (!result || result.statusCode !== 200) return null;
  return streamToJson(result.stream);
}

export async function saveFollowUpLead(record = {}) {
  if (!blobStorageConfigured()) return { ok: false, skipped: true, reason: 'storage_not_configured' };
  const id = String(record?.id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) return { ok: false, skipped: true, reason: 'invalid_lead' };

  await put(followUpLeadPath(id), JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
  return { ok: true, id };
}

export async function registerFollowUpLead(input = {}, options = {}) {
  if (!blobStorageConfigured()) return { ok: false, skipped: true, reason: 'storage_not_configured' };
  const now = options.now || new Date();
  const incoming = normalizeFollowUpLead(input, now);
  if (!incoming) return { ok: false, skipped: true, reason: 'invalid_lead' };

  const existing = await loadFollowUpLead(incoming.id);
  const record = mergeFollowUpLeadRecords(existing, incoming, now);
  await saveFollowUpLead(record);
  return { ok: true, created: !existing, id: record.id, record };
}

export async function listFollowUpLeads(options = {}) {
  if (!blobStorageConfigured()) return [];
  const requested = Number(options.limit || 200);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 200, MAX_LISTED_LEADS));
  const pathnames = [];
  let cursor;

  do {
    const page = await list({
      prefix: FOLLOWUP_LEAD_PREFIX,
      limit: Math.min(1000, Math.max(50, limit)),
      ...(cursor ? { cursor } : {})
    });
    for (const blob of page?.blobs || []) {
      const pathname = String(blob?.pathname || '');
      if (/^followups\/leads\/[a-f0-9]{32}\.json$/.test(pathname)) pathnames.push(pathname);
      if (pathnames.length >= limit) break;
    }
    cursor = page?.hasMore && pathnames.length < limit ? page?.cursor : undefined;
  } while (cursor);

  const records = (await Promise.all(pathnames.map(async (pathname) => {
    const id = pathname.slice(FOLLOWUP_LEAD_PREFIX.length, -5);
    return loadFollowUpLead(id);
  }))).filter(Boolean);

  records.sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  return records;
}
