import crypto from 'node:crypto';

// A credencial OneSignal é lida apenas do ambiente seguro da Vercel.
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
    subjects: fields.assuntos || '',
    name: fields.nome || '',
    phone: fields.contacto || '',
    visit: fields.visita || '',
    financing: fields.financiamento || '',
    tradeIn: fields.retoma || ''
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
      url: 'https://autovalorpt-assistente.vercel.app/',
      idempotency_key: idempotencyKey(text)
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'use_post' });
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: 'invalid_origin' });
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: 'rate_limited' });

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
    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('onesignal_notify_lead_failed', response.status, data?.errors || data?.error || 'unknown');
      return res.status(502).json({ ok: false, error: 'onesignal_failed' });
    }
    return res.status(200).json({ ok: true, id: data.id || null });
  } catch (error) {
    console.error('onesignal_notify_lead_error', error?.message || error);
    return res.status(502).json({ ok: false, error: 'onesignal_unreachable' });
  }
}
