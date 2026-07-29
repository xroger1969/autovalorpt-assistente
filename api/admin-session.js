import {
  adminTokenMatches,
  clearAdminCookie,
  setAdminCookie
} from '../lib/admin-security.js';
import {
  noStoreHeaders,
  readJsonBody,
  sameOriginRequest
} from '../lib/photo-security.js';

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });

  try {
    const body = await readJsonBody(req, 4 * 1024);
    if (body?.action === 'logout') {
      clearAdminCookie(res);
      return res.status(200).json({ ok: true });
    }

    const access = String(body?.access || '').trim();
    if (!adminTokenMatches(access)) {
      clearAdminCookie(res);
      return res.status(401).json({ error: 'Código de acesso inválido.' });
    }

    setAdminCookie(res, access);
    return res.status(200).json({ ok: true });
  } catch {
    clearAdminCookie(res);
    return res.status(400).json({ error: 'Pedido inválido.' });
  }
}
