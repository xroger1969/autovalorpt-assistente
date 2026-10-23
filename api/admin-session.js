import { createHash } from 'node:crypto';
import {
  adminConfigured,
  adminRequestAuthorized,
  adminTokenMatches,
  clearAdminCookie,
  setAdminCookie
} from '../lib/admin-security.js';
import { noStoreHeaders, readJsonBody, sameOriginRequest } from '../lib/photo-security.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function loginRateLimit(req, now = Date.now()) {
  const address = String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim().slice(0, 128);
  const key = createHash('sha256').update(address).digest('hex');
  if (attempts.size > 2000) {
    for (const [entry, times] of attempts) if (!times.some(time => now - time < WINDOW_MS)) attempts.delete(entry);
  }
  // Bound memory on warm serverless instances. The random access code remains
  // the primary brute-force defence; this limit also reduces accidental retries.
  if (!attempts.has(key) && attempts.size >= 5000) return true;
  const recent = (attempts.get(key) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) return true;
  attempts.set(key, [...recent, now]);
  return false;
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Cookie');
  if (!sameOriginRequest(req) || req?.headers?.['sec-fetch-site'] === 'cross-site') {
    return res.status(403).json({ error: 'Origem não autorizada.' });
  }

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, configured: adminConfigured(), authenticated: adminRequestAuthorized(req) });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método não suportado.' });
  }

  try {
    const body = await readJsonBody(req, 4 * 1024);
    if (Buffer.byteLength(JSON.stringify(body)) > 4 * 1024) throw new Error('body_size');
    if (body?.action === 'logout') {
      clearAdminCookie(res);
      return res.status(200).json({ ok: true });
    }
    if (!adminConfigured()) return res.status(503).json({ error: 'O acesso privado ainda não está configurado.' });
    if (loginRateLimit(req)) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ error: 'Demasiadas tentativas. Aguarde 15 minutos antes de voltar a tentar.' });
    }

    const access = String(body?.access || '').trim();
    if (!adminTokenMatches(access)) {
      clearAdminCookie(res);
      return res.status(401).json({ error: 'Código de acesso inválido.' });
    }
    setAdminCookie(res);
    return res.status(200).json({ ok: true });
  } catch {
    clearAdminCookie(res);
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
}
