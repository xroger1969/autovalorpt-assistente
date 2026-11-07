import { timingSafeEqual } from 'node:crypto';
import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, sameOriginRequest } from './photo-security.js';
import { createInstagramPublisher } from './instagram-publisher.js';

function cronAuthorized(req, env) {
  const secret = String(env.CRON_SECRET || '');
  const provided = String(req.headers?.authorization || '').replace(/^Bearer /, '');
  const actual = Buffer.from(provided); const expected = Buffer.from(secret);
  return secret.length >= 32 && actual.length === expected.length && timingSafeEqual(expected, actual);
}

export function createInstagramSyncHandler(options = {}) {
  const env = options.env || process.env;
  const publisher = options.publisher || createInstagramPublisher({ ...options, env });
  const report = options.report || ((entry) => console.error('instagram_sync_failed', JSON.stringify(entry)));
  const isAdmin = options.authorizeAdmin || ((req) => adminRequestAuthorized(req, env));
  return async (req, res) => {
    noStoreHeaders(res);
    res.setHeader('Referrer-Policy', 'no-referrer');
    const action = String(req.query?.action || 'status');
    const cron = cronAuthorized(req, env);
    const admin = isAdmin(req);
    if (!cron && !admin) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    if (!['status', 'dry-run', 'run'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_action' });
    if (action === 'run' && !cron && (req.method !== 'POST' || !sameOriginRequest(req))) return res.status(403).json({ ok: false, error: 'admin_post_required' });
    try { return res.status(200).json(await (action === 'status' ? publisher.status() : action === 'dry-run' ? publisher.dryRun() : publisher.run())); }
    catch (e) {
      const safeCode = typeof e?.code === 'string' && /^[a-z_]{3,60}$/.test(e.code) ? e.code : 'instagram_sync_failed';
      report({ action, error: safeCode,
        exceptionType: /^[A-Za-z]{0,50}(?:Error|Available|Limited)$/.test(e?.constructor?.name || '') ? e.constructor.name : 'Error',
        ...(String(e?.message || '').startsWith('Vercel Blob: ') ? { storageHints: ['etag', 'mismatch', 'overwrite', 'exists', 'denied', 'token', 'expired', 'bad request', 'cache', 'minimum', 'ifmatch', 'allowed', 'store', 'suspended', 'aborted', 'unknown', 'available', 'rate'].filter((word) => e.message.toLowerCase().includes(word)) } : {}),
        source: [...String(e?.stack || '').matchAll(/(?:lib|api)\/[a-z-]+\.js:\d+:\d+/g)].slice(0, 4).map((match) => match[0]),
        ...(Number.isSafeInteger(e?.metaStatus) ? { metaStatus: e.metaStatus } : {}),
        ...(Number.isSafeInteger(e?.metaCode) ? { metaCode: e.metaCode } : {}) });
      return res.status(503).json({ ok: false, error: safeCode, publicationConfirmed: false, inspectStatusBeforeRetry: true,
        ...(Number.isSafeInteger(e?.metaStatus) ? { metaStatus: e.metaStatus } : {}),
        ...(Number.isSafeInteger(e?.metaCode) ? { metaCode: e.metaCode } : {}) });
    }
  };
}

export default createInstagramSyncHandler();
