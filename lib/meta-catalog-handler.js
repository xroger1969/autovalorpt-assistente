import { timingSafeEqual } from 'node:crypto';
import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, sameOriginRequest } from './photo-security.js';
import { createMetaCatalog } from './meta-catalog.js';

function cronAuthorized(req, env) {
  const secret = String(env.CRON_SECRET || '');
  const authorization = String(req.headers?.authorization || '');
  if (!authorization.startsWith('Bearer ')) return false;
  const received = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return secret.length >= 32 && received.length === expected.length && timingSafeEqual(received, expected);
}

const safeCode = (value, fallback) => /^[a-z_]{1,70}$/.test(String(value || '')) ? value : fallback;
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 5000 ? value : null;

export function createMetaCatalogHandler(options = {}) {
  const env = options.env || process.env;
  const catalog = options.catalog || createMetaCatalog({ ...options, env });
  const isAdmin = options.authorizeAdmin || ((req) => adminRequestAuthorized(req, env));
  const log = options.log || ((event, data) => console.info(event, JSON.stringify(data)));
  return async (req, res) => {
    noStoreHeaders(res);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    const cron = cronAuthorized(req, env);
    if (!cron && !isAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const action = String(req.query?.action || 'status');
    if (!['status', 'check', 'run'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_action' });
    // Checking persists a private audit record. Browser actions therefore use
    // POST with the same CSRF protections as the existing private integrations.
    if (action !== 'status' && !cron && (req.method !== 'POST' || !req.headers?.origin || !sameOriginRequest(req))) {
      return res.status(403).json({ ok: false, error: 'admin_post_required' });
    }
    try {
      const result = await catalog[action]();
      if (action !== 'status') log('meta_catalog_result', {
        action, status: safeCode(result?.status, 'unknown'),
        reason: safeCode(result?.reason || result?.error, null),
        expectedCount: safeCount(result?.expectedCount), actualCount: safeCount(result?.actualCount),
        // Only explicitly verified server results can set this flag. An upload
        // session or a scheduled time alone does not prove catalogue equality.
        catalogConfirmed: result?.catalogConfirmed === true,
      });
      return res.status(200).json(result);
    } catch (error) {
      const code = safeCode(error?.code, 'catalog_check_failed');
      log('meta_catalog_failed', { action, error: code });
      return res.status(503).json({ ok: false, error: code, catalogConfirmed: false, inspectStatusBeforeRetry: true });
    }
  };
}

export default createMetaCatalogHandler();
