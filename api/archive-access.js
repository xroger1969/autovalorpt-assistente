import crypto from 'node:crypto';
import { createArchiveAccessToken, archiveAccessConfigured } from '../lib/archive-auth.js';
import { noStoreHeaders, sameOriginRequest } from '../lib/photo-security.js';

const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';
const EXTERNAL_ID = 'autovalorpt-carlos';
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 3;
const buckets = new Map();

function requestBaseUrl(req) {
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${protocol}://${host}`;
}

function rateLimited(req) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const recent = (buckets.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= LIMIT) {
    buckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  buckets.set(ip, recent);
  return false;
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'use_post' });
  if (!sameOriginRequest(req)) return res.status(403).json({ ok: false, error: 'invalid_origin' });
  if (rateLimited(req)) return res.status(429).json({ ok: false, error: 'rate_limited' });
  if (!archiveAccessConfigured()) return res.status(503).json({ ok: false, error: 'archive_access_not_configured' });

  const apiKey = process.env.ONESIGNAL_AUTOVALORPT_API_KEY || process.env.ONESIGNAL_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, error: 'onesignal_not_configured' });

  try {
    const access = createArchiveAccessToken();
    const url = new URL('/arquivo-retomas.html', requestBaseUrl(req));
    url.searchParams.set('access', access);

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${apiKey}`
      },
      body: JSON.stringify({
        app_id: APP_ID,
        target_channel: 'push',
        include_aliases: { external_id: [EXTERNAL_ID] },
        headings: { en: '🔐 Arquivo de Retomas AutoValorPT' },
        contents: { en: 'Toque para abrir o arquivo privado. Este acesso é válido durante 30 minutos.' },
        data: { source: 'autovalorpt', kind: 'archive_access' },
        url: url.toString(),
        idempotency_key: crypto.randomUUID()
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('archive_access_push_failed', response.status, data?.errors || data?.error || 'unknown');
      return res.status(502).json({ ok: false, error: 'onesignal_failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('archive_access_error', error?.message || error);
    return res.status(500).json({ ok: false, error: 'archive_access_failed' });
  }
}
