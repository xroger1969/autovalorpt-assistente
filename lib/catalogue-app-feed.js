import { createHash } from 'node:crypto';
import { createStockSource } from './stock-source.js';
import { parseInstagramFeed } from './instagram-publisher.js';
import { validateFeed } from './meta-catalog-source.js';

const WHATSAPP = '351965637736';
const HASH = /^[a-f0-9]{64}$/;

// Only decode the explicit format written by stockFeedRow. Model numbers,
// free-form legacy descriptions and conflicting text are not vehicle facts.
function publicVehicle(item) {
  let title = item.title;
  let year = null;
  let mileage = null;
  let fuel = '';
  const suffix = title.match(/^(.*?) \| ((?:19|20)\d{2}) \| (\d{1,3}(?: \d{3})*|\d{1,7}) km$/);
  if (suffix && suffix[1].trim()) {
    const distance = Number(suffix[3].replaceAll(' ', ''));
    if (Number.isSafeInteger(distance) && distance <= 3_000_000) {
      title = suffix[1];
      year = Number(suffix[2]);
      mileage = distance;
      const prefix = `${title}. `;
      const ending = `. ${suffix[2]}. ${suffix[3]} km.`;
      if (item.description.startsWith(prefix) && item.description.endsWith(ending)) {
        const recordedFuel = item.description.slice(prefix.length, -ending.length);
        if (recordedFuel && recordedFuel.length <= 100 && !/[\u0000-\u001f<>]/.test(recordedFuel)) fuel = recordedFuel;
      }
    }
  }
  // Deliberate field projection: never expose the stored state, private source
  // diagnostics, access tokens, historical rows or arbitrary future fields.
  return {
    id: item.id, title, brand: item.brand, year, mileage,
    price: Number(item.price.split(' ')[0]), fuel,
    image: item.image_link, url: item.link,
  };
}

export function createCatalogueAppFeed(options = {}) {
  const source = options.source || createStockSource(options);
  return async function catalogueAppFeed(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }
    try {
      // Public visits read exactly the same committed, original-photo snapshot
      // used by WhatsApp. They never refresh, scrape, synchronise or publish.
      const snapshot = await source.feed('latest');
      if (!snapshot || typeof snapshot.csv !== 'string' || !HASH.test(snapshot.fingerprint || '') ||
          createHash('sha256').update(snapshot.csv).digest('hex') !== snapshot.fingerprint ||
          typeof snapshot.checkedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.checkedAt))) {
        throw new Error('invalid_snapshot');
      }
      const rows = parseInstagramFeed(snapshot.csv);
      validateFeed(rows, 'catalog');
      if (snapshot.count !== rows.length) throw new Error('invalid_snapshot');
      const items = rows.map(publicVehicle);
      const body = {
        ok: true, updatedAt: new Date(snapshot.checkedAt).toISOString(),
        revision: snapshot.fingerprint, total: items.length, items,
        contact: { whatsapp: WHATSAPP },
      };
      // The browser keeps no inventory cache; a short, explicit CDN cache can
      // reduce storage reads without ever caching authenticated integrations.
      res.setHeader('CDN-Cache-Control', 'public, max-age=30, must-revalidate');
      if (req.method === 'HEAD') return res.status(200).end();
      return res.status(200).json(body);
    } catch {
      // Missing or corrupt state is not an empty catalogue. No private error,
      // provider response or credential is ever returned to a visitor.
      if (req.method === 'HEAD') return res.status(503).end();
      return res.status(503).json({ ok: false, error: 'catalogue_unavailable' });
    }
  };
}

export default createCatalogueAppFeed();
