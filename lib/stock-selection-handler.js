import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, readJsonBody, sameOriginRequest } from './photo-security.js';
import { createStockSource } from './stock-source.js';
import { createPreparedCatalogSource } from './catalog-photo-source.js';
import { createMetaCatalog } from './meta-catalog.js';

function decisionError(res, code) {
  if (['stock_selection_stale', 'source_sync_conflict', 'stock_selection_duplicate'].includes(code)) {
    return res.status(409).json({ ok: false, error: code });
  }
  if (code === 'stock_selection_invalid') return res.status(400).json({ ok: false, error: code });
  return res.status(503).json({ ok: false, error: 'stock_selection_unavailable' });
}

export function createStockSelectionHandler(options = {}) {
  const env = options.env || process.env;
  const source = options.source || createStockSource({ ...options, env });
  const isAdmin = options.authorizeAdmin || (req => adminRequestAuthorized(req, env));
  const auditSource = createPreparedCatalogSource({ stockSource: source }).audit;
  return async (req, res) => {
    noStoreHeaders(res);
    if (!isAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    if (req.method === 'POST' && (!req.headers?.origin || !sameOriginRequest(req)))
      return res.status(403).json({ ok: false, error: 'admin_post_required' });
    try {
      if (req.method === 'GET') return res.status(200).json({ ok: true, review: await source.review() });
      let decision;
      try { decision = await readJsonBody(req, 96 * 1024); }
      catch { return decisionError(res, 'stock_selection_invalid'); }
      if (!decision || !['all', 'choose'].includes(decision.mode) || !/^[a-f0-9]{64}$/.test(decision.revision || ''))
        return decisionError(res, 'stock_selection_invalid');
      const started = Date.now();
      const result = await source.decide(decision);
      if (result?.valid !== true) return decisionError(res, result?.reason);
      // The iOS snapshot is committed. A downstream error cannot roll it back.
      let status = 'check_deferred';
      const remaining = 275000 - (Date.now() - started);
      if (remaining >= 30000) {
        try {
          const catalog = options.catalog || createMetaCatalog({ ...options, env, auditSource, runBudgetMs: Math.min(180000, remaining) });
          const whatsapp = await catalog.run();
          status = whatsapp.status;
        } catch { status = 'check_failed'; }
      }
      return res.status(200).json({ ok: true, total: result.expectedCount, whatsapp: { status } });
    } catch (error) { return decisionError(res, error?.code); }
  };
}

export default createStockSelectionHandler();
