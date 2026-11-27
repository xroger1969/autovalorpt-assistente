import { createStockSource, parseCatalogStockCsv } from './stock-source.js';
import { createCatalogSource } from './catalog-feed.js';
import { additionalStockPhotos } from './stock-photos.js';

const xmlText = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

export function stockFeedXml(csv) {
  const fields = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
  const rows = parseCatalogStockCsv(csv);
  const items = rows.map(item => {
    const additional = additionalStockPhotos(item);
    if (!additional) throw new Error('invalid_gallery');
    // Repeated XML elements are Meta's documented multi-image format. Each
    // original URL fits the field limit even when the combined list exceeds
    // the 2,000-character limit of the CSV string representation.
    return ['<item>', ...fields.map(field => `<g:${field}>${xmlText(item[field])}</g:${field}>`),
      ...additional.map(url => `<additional_image_link>${xmlText(url)}</additional_image_link>`), '</item>'].join('\n');
  });
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '<channel><title>AutoValorPT</title><link>https://autovalorpt-assistente.vercel.app/app/index.html</link><description>Viaturas AutoValorPT e Samucar</description>',
    ...items, '</channel></rss>'].join('\n') + '\n';
}

export function createPublicCatalogFeed(options = {}) {
  const raw = options.stockSource || createStockSource(options);
  const prepared = options.catalogSource || createCatalogSource({ ...options, stockSource: raw });
  return { async feed(fingerprint) {
    // The live feed must always use the original Standvirtual photos. Keep
    // historical immutable snapshot URLs readable for past Meta imports only.
    if (fingerprint === 'latest') return raw.feed('latest');
    try { return await prepared.feed(fingerprint); }
    catch (error) {
      // Historical raw snapshots remain valid. A corrupt prepared snapshot or
      // an uncertain storage read must never silently select another feed.
      if (error?.code !== 'catalog_snapshot_not_found') throw error;
      return raw.feed(fingerprint);
    }
  } };
}

// Public commercial feed only. Synchronisation is exclusively a private
// coordinator operation; a public request cannot write state or start a job.
export function createStockFeedHandler(options = {}) {
  const source = options.source || createPublicCatalogFeed(options);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const fingerprint = req.query?.snapshot;
    if (typeof fingerprint !== 'string' || !(fingerprint === 'latest' || /^[a-f0-9]{64}$/.test(fingerprint)))
      return res.status(400).json({ ok: false, error: 'invalid_snapshot' });
    const format = req.query?.format || 'csv';
    if (!['csv', 'xml'].includes(format)) return res.status(400).json({ ok: false, error: 'invalid_format' });
    try {
      const result = await source.feed(fingerprint);
      res.setHeader('Content-Type', format === 'xml' ? 'application/rss+xml; charset=utf-8' : 'text/csv; charset=utf-8');
      return res.status(200).send(format === 'xml' ? stockFeedXml(result.csv) : result.csv);
    } catch {
      // Never return an empty catalogue when storage or validation fails.
      return res.status(503).json({ ok: false, error: 'stock_snapshot_unavailable' });
    }
  };
}
export default createStockFeedHandler();
