import { createStockSource } from './stock-source.js';

// Public commercial feed only. Synchronisation is exclusively a private
// coordinator operation; a public request cannot write state or start a job.
export function createStockFeedHandler(options = {}) {
  const source = options.source || createStockSource(options);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const fingerprint = req.query?.snapshot;
    if (typeof fingerprint !== 'string' || !(fingerprint === 'latest' || /^[a-f0-9]{64}$/.test(fingerprint)))
      return res.status(400).json({ ok: false, error: 'invalid_snapshot' });
    try {
      const result = await source.feed(fingerprint);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.status(200).send(result.csv);
    } catch {
      // Never return an empty catalogue when storage or validation fails.
      return res.status(503).json({ ok: false, error: 'stock_snapshot_unavailable' });
    }
  };
}
export default createStockFeedHandler();
