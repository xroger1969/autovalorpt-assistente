import { adminRequestAuthorized } from '../lib/admin-security.js';
import { noStoreHeaders, sameOriginRequest } from '../lib/photo-security.js';

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'use_post' });
  if (!sameOriginRequest(req)) return res.status(403).json({ ok: false, error: 'invalid_origin' });
  if (!adminRequestAuthorized(req)) return res.status(401).json({ ok: false, error: 'Entre na área privada para consultar o arquivo.', url: '/retomas.html' });
  // No access token or customer data is sent to the public push alias.
  return res.status(200).json({ ok: true, url: '/retomas.html' });
}
