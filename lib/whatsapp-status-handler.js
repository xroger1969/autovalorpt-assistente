import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { adminRequestAuthorized, readCookie } from './admin-security.js';
import { noStoreHeaders, readJsonBody } from './photo-security.js';
import { createWhatsappStatus, WHATSAPP_STATUS_COOKIE } from './whatsapp-status.js';

export function createWhatsappStatusHandler(options = {}) {
  const env = options.env || process.env;
  const service = options.service || createWhatsappStatus(options);
  const isAdmin = options.authorizeAdmin || (req => adminRequestAuthorized(req, env));
  return async (req, res) => {
    noStoreHeaders(res); res.setHeader('Referrer-Policy', 'no-referrer');
    const action = typeof req.query?.action === 'string' ? req.query.action : 'status';
    const reads = ['status', 'plan', 'media'];
    const writes = ['enroll', 'revoke', 'claim', 'begin', 'confirm', 'uncertain', 'close'];
    if (!reads.includes(action) && !writes.includes(action)) return res.status(400).json({ ok: false, error: 'status_action_invalid' });
    if (req.method !== (reads.includes(action) ? 'GET' : 'POST')) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    if (writes.includes(action)) {
      let sameOrigin = false;
      try { const origin = new URL(req.headers?.origin || ''); sameOrigin = origin.protocol === 'https:' && origin.host === String(req.headers?.host || '') && !origin.username && !origin.password; } catch {}
      if (!sameOrigin || req.headers?.['sec-fetch-site'] === 'cross-site') return res.status(403).json({ ok: false, error: 'origin_not_allowed' });
    }
    const context = { admin: isAdmin(req), token: readCookie(req, WHATSAPP_STATUS_COOKIE) };
    if (!context.admin && !/^[A-Za-z0-9_-]{43}$/.test(context.token)) return res.status(401).json({ ok: false, error: 'status_unauthorized' });
    try {
      const input = reads.includes(action) ? { attemptId: req.query?.attempt } : await readJsonBody(req, 2048);
      const result = await service[action](context, input);
      if (action === 'media') {
        res.setHeader('Content-Type', 'video/mp4'); res.setHeader('Content-Length', String(result.bytes));
        res.setHeader('Content-Disposition', `attachment; filename="AutoValorPT_${result.id}.mp4"`);
        res.setHeader('Accept-Ranges', 'none');
        return await pipeline(Readable.fromWeb(result.stream), res);
      }
      if (result.cookie) res.setHeader('Set-Cookie', result.cookie);
      return res.status(200).json(result.data || result);
    } catch (error) {
      const code = /^status_[a-z_]{1,60}$/.test(error?.code || '') ? error.code : 'status_unavailable';
      if (res.headersSent) return res.destroy();
      return res.status(code === 'status_unauthorized' ? 401 : ['status_storage_unavailable', 'status_unavailable'].includes(code) ? 503 : 409).json({ ok: false, error: code });
    }
  };
}
export default createWhatsappStatusHandler();
