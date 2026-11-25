import { timingSafeEqual } from 'node:crypto';
import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, readJsonBody, sameOriginRequest } from './photo-security.js';
import { createInstagramEditorial } from './instagram-editorial.js';

function cronAuthorized(req, env) {
  const expected = Buffer.from(String(env.CRON_SECRET || ''));
  const actual = Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer /, ''));
  return expected.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createInstagramEditorialHandler(options = {}) {
  const env = options.env || process.env;
  const publisher = options.publisher || createInstagramEditorial({ ...options, env });
  const authorizeAdmin = options.authorizeAdmin || (req => adminRequestAuthorized(req, env));
  const report = options.report || (entry => console.info('instagram_editorial_result', JSON.stringify(entry)));
  return async (req, res) => {
    noStoreHeaders(res);
    res.setHeader('Referrer-Policy', 'no-referrer');
    const cron = cronAuthorized(req, env);
    const admin = authorizeAdmin(req);
    if (!cron && !admin) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const action = typeof req.query?.action === 'string' ? req.query.action : 'status';
    if (!['status', 'calendar', 'preview', 'settings', 'validate', 'run', 'extra-run'].includes(action)) return res.status(400).json({ ok: false, error: 'invalid_action' });
    if (action === 'calendar' && req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const sameOriginAdminPost = admin && req.method === 'POST' && Boolean(req.headers?.origin) && sameOriginRequest(req);
    if (['settings','extra-run'].includes(action) && !sameOriginAdminPost) return res.status(403).json({ ok: false, error: 'admin_post_required' });
    if (['run', 'validate'].includes(action) && !cron && !sameOriginAdminPost) return res.status(403).json({ ok: false, error: 'admin_post_required' });
    if (req.query?.season !== undefined && !['summer', 'winter'].includes(req.query.season)) return res.status(400).json({ ok: false, error: 'invalid_season' });
    try {
      let result;
      if (action === 'status') result = await publisher.status();
      else if (action === 'calendar') result = await publisher.calendar();
      else if (action === 'preview') {
        const date = req.query?.date;
        if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
          return res.status(400).json({ ok: false, error: 'invalid_editorial_date' });
        }
        result = await publisher.preview(date);
      } else if (action === 'settings') {
        let body;
        try { body = await readJsonBody(req, 512); }
        catch { return res.status(400).json({ ok: false, error: 'invalid_settings' }); }
        if (!body || typeof body.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'invalid_settings' });
        result = await publisher.setEnabled(body.enabled);
      } else if (action === 'validate') result = await publisher.validate();
      else if (action === 'extra-run') result = await publisher.run({extra:true});
      else result = await publisher.run({ season: req.query?.season });
      if (['run', 'validate', 'settings', 'extra-run'].includes(action)) report({ action,
        status: /^[a-z_]{1,60}$/.test(result?.status || '') ? result.status : 'completed',
        published: result?.published === 1 ? 1 : 0,
        ...(typeof result?.enabled === 'boolean' ? { enabled: result.enabled } : {}) });
      return res.status(200).json(result);
    } catch (error) {
      const code = /^[a-z_]{3,70}$/.test(error?.code || '') ? error.code : 'editorial_unavailable';
      report({ action, status: 'review_required', error: code, published: 0 });
      const invalidDate = /(?:invalid.*date|date.*invalid|date.*range)/.test(code);
      return res.status(invalidDate ? 400 : 503).json({ ok: false, error: code,
        publicationConfirmed: false, inspectStatusBeforeRetry: true });
    }
  };
}

export default createInstagramEditorialHandler();
