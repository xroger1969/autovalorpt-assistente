import crypto from 'node:crypto';
import { runFollowUpDryRun } from '../lib/followup-dry-run.js';
import { registerFollowUpLead } from '../lib/followup-registry.js';

// As credenciais OneSignal e Slack são lidas apenas do ambiente seguro da Vercel.
const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';
const EXTERNAL_ID = 'autovalorpt-carlos';
const MAX_TEXT = 4000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const buckets = new Map();

function clean(value = '', max = 180) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseLead(text = '') {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const fields = {};
  for (const line of lines) {
    const match = line.match(/^([^:]{2,40}):\s*(.+)$/);
    if (!match) continue;
    fields[match[1].toLocaleLowerCase('pt-PT')] = clean(match[2], 500);
  }
  return {
    vehicle: fields.viatura || '',
    vehicleUrl: fields['anúncio'] || fields.anuncio || '',
    subjects: fields.assuntos || '',
    name: fields.nome || '',
    phone: fields.contacto || '',
    visit: fields.visita || '',
    financing: fields.financiamento || '',
    tradeIn: fields.retoma || '',
    observations: fields['observações'] || fields.observacoes || ''
  };
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function rateLimited(req) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const recent = (buckets.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    buckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return false;
}

function idempotencyKey(text = '') {
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const hex = crypto.createHash('sha256').update(`${bucket}:${text}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeTokenMatch(received = '', expected = '') {
  if (!received || !expected) return false;
  const actual = Buffer.from(String(received));
  const wanted = Buffer.from(String(expected));
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

function bearerToken(req) {
  const header = String(req?.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function handleFollowUpDryRun(req, res) {
  const expected = String(process.env.FOLLOWUP_DRY_RUN_TOKEN || '').trim();
  if (!expected) return res.status(503).json({ ok: false, error: 'dry_run_not_configured' });
  if (!safeTokenMatch(bearerToken(req), expected)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  const requestedNow = req.body?.now ? new Date(req.body.now) : new Date();
  if (Number.isNaN(requestedNow.getTime())) {
    return res.status(400).json({ ok: false, error: 'invalid_now' });
  }

  try {
    const report = await runFollowUpDryRun(requestedNow, {
      timeZone: 'Europe/Lisbon',
      limit: Math.min(500, Math.max(1, Number(req.body?.limit || 200)))
    });
    return res.status(200).json({ ok: true, ...report });
  } catch (error) {
    console.error('followup_dry_run_failed', error?.message || error);
    return res.status(500).json({ ok: false, error: 'dry_run_failed' });
  }
}

function summaryUrl(lead = {}) {
  const url = new URL('https://autovalorpt-assistente.vercel.app/aviso-lead.html');
  const fields = [
    ['viatura', lead.vehicle],
    ['cliente', lead.name],
    ['assuntos', lead.subjects],
    ['visita', lead.visit],
    ['financiamento', lead.financing],
    ['retoma', lead.tradeIn]
  ];
  for (const [key, value] of fields) {
    const safe = clean(value, 320);
    if (safe) url.searchParams.set(key, safe);
  }
  return url.toString();
}

function slackMessage(lead = {}) {
  const lines = [
    '🚗 *NOVO LEAD — AutoValorPT*',
    '',
    `👤 *Nome:* ${lead.name || 'Não indicado'}`,
    `📱 *Contacto:* ${lead.phone || 'Não indicado'}`,
    `🚘 *Viatura:* ${lead.vehicle || 'Não indicada'}`
  ];
  if (lead.vehicleUrl) lines.push(`🔗 *Anúncio:* ${lead.vehicleUrl}`);
  if (lead.subjects) lines.push(`🎯 *Interesse:* ${lead.subjects}`);
  if (lead.financing) lines.push(`💳 *Financiamento:* ${lead.financing}`);
  if (lead.tradeIn) lines.push(`🔄 *Retoma:* ${lead.tradeIn}`);
  if (lead.visit) lines.push(`📅 *Visita:* ${lead.visit}`);
  if (lead.observations) lines.push(`📝 *Observações:* ${lead.observations}`);
  lines.push('', '✅ Pedido enviado pelo Assistente AI CV.');
  return lines.join('\n');
}

async function sendSlack(lead = {}) {
  const webhook = String(process.env.SLACK_WEBHOOK_URL || '').trim();
  if (!webhook) return { ok: false, skipped: true, error: 'slack_not_configured' };
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: slackMessage(lead) })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('slack_notify_lead_failed', response.status, detail.slice(0, 200));
      return { ok: false, error: 'slack_failed' };
    }
    return { ok: true };
  } catch (error) {
    console.error('slack_notify_lead_error', error?.message || error);
    return { ok: false, error: 'slack_unreachable' };
  }
}

async function registerLeadForDryRun(lead = {}) {
  try {
    return await registerFollowUpLead({
      ...lead,
      source: 'autovalorpt-assistente',
      canContact: true,
      status: 'open',
      vehicleStatus: 'available'
    });
  } catch (error) {
    console.error('followup_registry_failed', error?.message || error);
    return { ok: false, skipped: true, reason: 'registry_failed' };
  }
}

export function buildNotification(text = '') {
  const lead = parseLead(text);
  const isVisit = Boolean(lead.visit || /visita/i.test(lead.subjects));
  const heading = isVisit
    ? `🚗 Nova visita${lead.name ? ` — ${lead.name}` : ''}`
    : `🚘 Nova lead${lead.name ? ` — ${lead.name}` : ''}`;

  const details = [];
  if (lead.vehicle) details.push(lead.vehicle);
  if (lead.visit) details.push(lead.visit);
  else if (lead.subjects) details.push(lead.subjects);
  if (lead.financing) details.push(`Financiamento: ${lead.financing}`);
  if (lead.tradeIn) details.push(`Retoma: ${lead.tradeIn}`);

  const openUrl = summaryUrl(lead);

  return {
    lead,
    payload: {
      app_id: APP_ID,
      target_channel: 'push',
      include_aliases: { external_id: [EXTERNAL_ID] },
      headings: { en: heading.slice(0, 120) },
      contents: { en: (details.join(' · ') || 'Novo pedido recebido no AutoValorPT').slice(0, 350) },
      data: {
        source: 'autovalorpt',
        kind: isVisit ? 'visit_request' : 'lead',
        vehicle: lead.vehicle,
        visit: lead.visit
      },
      url: openUrl,
      idempotency_key: idempotencyKey(text)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'use_post' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: 'invalid_origin' });
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  if (String(req.body?.action || '') === 'followup-dry-run') {
    return handleFollowUpDryRun(req, res);
  }

  const apiKey = process.env.ONESIGNAL_AUTOVALORPT_API_KEY || process.env.ONESIGNAL_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, error: 'onesignal_not_configured' });

  const text = String(req.body?.text || '').replace(/[<>]/g, '').trim().slice(0, MAX_TEXT);
  if (!text.startsWith('Olá Carlos, venho do assistente AutoValorPT.')) {
    return res.status(400).json({ ok: false, error: 'invalid_lead' });
  }

  const { lead, payload } = buildNotification(text);
  if (!lead.vehicle || !lead.name || !lead.phone) {
    return res.status(400).json({ ok: false, error: 'incomplete_lead' });
  }

  try {
    const [oneSignalResponse, slack, followupRegistry] = await Promise.all([
      fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`
        },
        body: JSON.stringify(payload)
      }),
      sendSlack(lead),
      registerLeadForDryRun(lead)
    ]);

    const data = await oneSignalResponse.json().catch(() => ({}));
    if (!oneSignalResponse.ok) {
      console.error('onesignal_notify_lead_failed', oneSignalResponse.status, data?.errors || data?.error || 'unknown');
      return res.status(502).json({ ok: false, error: 'onesignal_failed', slack });
    }

    return res.status(200).json({
      ok: true,
      id: data.id || null,
      onesignal: true,
      slack: Boolean(slack.ok),
      followupRegistry: Boolean(followupRegistry?.ok),
      followupMode: 'dry-run'
    });
  } catch (error) {
    console.error('notify_lead_error', error?.message || error);
    return res.status(502).json({ ok: false, error: 'notification_unreachable' });
  }
}
