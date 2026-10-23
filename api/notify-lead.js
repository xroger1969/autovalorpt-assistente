import { createHash, timingSafeEqual } from 'node:crypto';
import { adminRequestAuthorized } from '../lib/admin-security.js';
import { attachPhotoSessionToLead } from '../lib/photo-manifest.js';
import { noStoreHeaders, readJsonBody, sameOriginRequest } from '../lib/photo-security.js';
import { createLeadRepository, leadNamespace, normalizeLead, receiptFor } from '../lib/lead-registry.js';
import { createNotificationService, publicNotificationStatuses } from '../lib/lead-notifications.js';

const LEAD_ID = /^[a-f0-9]{32}$/;
const MAX_BODY_BYTES = 24 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 20;

export function parseLegacyLead(text = '') {
  const source = String(text).trim();
  if (!source.startsWith('Olá Carlos, venho do assistente AutoValorPT.')) return null;
  const fields = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^([^:]{2,50}):\s*(.*)$/);
    if (match) fields[match[1].toLocaleLowerCase('pt-PT')] = match[2].trim();
  }
  return normalizeLead({
    vehicle: fields.viatura || '', vehicleUrl: fields['anúncio'] || fields.anuncio || '',
    subjects: fields.assuntos || '', name: fields.nome || '', phone: fields.contacto || '',
    visit: fields.visita || '', financing: fields.financiamento || '', tradeIn: fields.retoma || '',
    registration: fields['matrícula'] || fields.matricula || '',
    observations: fields['observações'] || fields.observacoes || fields.pergunta || ''
  });
}

export function legacyRequestId(lead) {
  const digest = createHash('sha256').update(`autovalorpt-legacy-v1:${JSON.stringify(lead)}`).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function cronAuthorized(req, env) {
  const expected = String(env.CRON_SECRET || '');
  if (expected.length < 32) return false;
  const match = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const actual = Buffer.from(match[1]);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function createNotifyLeadHandler(options = {}) {
  const env = options.env || process.env;
  const repository = options.repository || createLeadRepository({ namespace: options.namespace || leadNamespace(env) });
  const notifications = options.notifications || createNotificationService({ repository, env, fetchImpl: options.fetchImpl });
  const attachPhotos = options.attachPhotos || attachPhotoSessionToLead;
  const authorizeAdmin = options.authorizeAdmin || ((req) => adminRequestAuthorized(req, env));
  const now = options.now || (() => Date.now());
  const buckets = new Map();

  function rateLimited(req) {
    const time = now();
    const ip = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    for (const [key, bucket] of buckets) if (time >= bucket.resetAt) buckets.delete(key);
    const current = buckets.get(ip) || { count: 0, resetAt: time + RATE_WINDOW_MS };
    if (buckets.size >= 10000 && !buckets.has(ip)) return true;
    current.count += 1;
    buckets.set(ip, current);
    return current.count > RATE_LIMIT;
  }

  async function adminRecord(record) {
    return { ...record, receipt: receiptFor(record), notifications: await repository.notifications(record.id) };
  }

  async function getAdmin(req, res) {
    if (!authorizeAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    const action = String(req.query?.action || 'list');
    if (action === 'get') {
      const id = String(req.query?.id || '');
      if (!LEAD_ID.test(id)) return res.status(400).json({ ok: false, error: 'invalid_lead_id' });
      const record = await repository.loadRecord(id);
      if (!record) return res.status(404).json({ ok: false, error: 'lead_not_found' });
      return res.status(200).json({ ok: true, lead: await adminRecord(record) });
    }
    if (action !== 'list') return res.status(400).json({ ok: false, error: 'invalid_action' });
    const cursor = String(req.query?.cursor || '');
    if (cursor.length > 1000) return res.status(400).json({ ok: false, error: 'invalid_cursor' });
    const page = await repository.page({ cursor: cursor || undefined, limit: 20 });
    const items = [];
    for (let i = 0; i < page.items.length; i += 5) items.push(...await Promise.all(page.items.slice(i, i + 5).map(adminRecord)));
    return res.status(200).json({ ok: true, items, cursor: page.cursor, configuration: notifications.configuration() });
  }

  async function retryPending(req, res) {
    if (!cronAuthorized(req, env)) return res.status(401).json({ ok: false, error: 'cron_unauthorized' });
    const page = await repository.page({ limit: 8, outbox: true });
    let processed = 0;
    let failed = 0;
    for (let offset = 0; offset < page.items.length; offset += 2) {
      const results = await Promise.allSettled(page.items.slice(offset, offset + 2).map((record) => notifications.notify(record)));
      for (const result of results) {
        if (result.status === 'fulfilled') processed += 1;
        else failed += 1;
      }
    }
    return res.status(200).json({ ok: failed === 0, processed, failed });
  }

  async function postAdmin(req, res, body) {
    if (!authorizeAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    const leadId = String(body.leadId || '');
    if (!LEAD_ID.test(leadId)) return res.status(400).json({ ok: false, error: 'invalid_lead_id' });
    if (body.action === 'status') {
      const record = await repository.setStatus(leadId, String(body.status || ''));
      if (!record) return res.status(404).json({ ok: false, error: 'lead_not_found' });
      return res.status(200).json({ ok: true, leadId, status: record.status });
    }
    const record = await repository.loadRecord(leadId);
    if (!record) return res.status(404).json({ ok: false, error: 'lead_not_found' });
    const states = await notifications.notify(record, { allowUnknown: body.retryUnconfirmed === true, manual: true });
    return res.status(200).json({ ok: true, leadId, notifications: states });
  }

  return async function handler(req, res) {
    noStoreHeaders(res);
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    try {
      if (req.method === 'GET') {
        if (req.query?.action === 'retry-pending') return await retryPending(req, res);
        return await getAdmin(req, res);
      }
      if (!sameOriginRequest(req)) return res.status(403).json({ ok: false, error: 'invalid_origin' });
      let body;
      try { body = await readJsonBody(req, MAX_BODY_BYTES); }
      catch (error) {
        const large = /demasiado grande/.test(error?.message || '');
        return res.status(large ? 413 : 400).json({ ok: false, error: large ? 'request_too_large' : 'invalid_json' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ ok: false, error: 'invalid_request' });
      if (body.action === 'retry' || body.action === 'status') return await postAdmin(req, res, body);
      if (body.action) return res.status(400).json({ ok: false, error: 'invalid_action' });
      if (rateLimited(req)) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({ ok: false, error: 'rate_limited' });
      }
      const legacy = typeof body.text === 'string' && !body.lead;
      const lead = legacy ? parseLegacyLead(body.text) : normalizeLead(body.lead);
      if (!lead) return res.status(422).json({ ok: false, error: 'invalid_lead', persisted: false });
      const requestId = legacy ? legacyRequestId(lead) : String(body.requestId || '');
      const photoSession = legacy ? null : body.photoSession || null;
      if (photoSession && (typeof photoSession !== 'object' || Array.isArray(photoSession))) return res.status(422).json({ ok: false, error: 'invalid_photo_session', persisted: false });
      const record = await repository.saveSubmission({ requestId, lead, photoSession, attachPhotos, source: legacy ? 'assistant-legacy' : 'assistant' });
      // The record, inbox and outbox are durable. Notification failures cannot
      // turn this acknowledged lead into a lost contact or a duplicate retry.
      let states;
      try { states = await notifications.notify(record); }
      catch {
        try { states = await repository.notifications(record.id); }
        catch { states = {}; }
        console.error('lead_notification_recovery_pending');
      }
      return res.status(200).json({
        ok: true, persisted: true, leadId: record.id, receipt: receiptFor(record),
        notifications: publicNotificationStatuses(states)
      });
    } catch (error) {
      const status = [400, 409, 422].includes(error?.status) ? error.status : 503;
      const safeCodes = new Set(['invalid_request_id', 'request_id_conflict', 'invalid_status', 'invalid_photo_session', 'photos_already_attached', 'photo_session_expired', 'photos_not_ready']);
      const code = safeCodes.has(error?.code) ? error.code : safeCodes.has(error?.message) ? error.message : 'storage_unavailable';
      if (status === 503) console.error('lead_storage_operation_failed');
      return res.status(status).json({ ok: false, persisted: false, error: code });
    }
  };
}

export default createNotifyLeadHandler();
