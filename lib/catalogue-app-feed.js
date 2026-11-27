import { createHash } from 'node:crypto';
import { createStockSource, parseCatalogStockCsv } from './stock-source.js';
import { validateFeed } from './meta-catalog-source.js';
import { originalPhotoGallery, additionalStockPhotos } from './stock-photos.js';

const WHATSAPP = '351965637736';
const HASH = /^[a-f0-9]{64}$/;

// Only decode the explicit format written by stockFeedRow. Model numbers,
// free-form legacy descriptions and conflicting text are not vehicle facts.
function publicVehicle(item, images) {
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
    image: item.image_link, images, url: item.link,
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
      const rows = parseCatalogStockCsv(snapshot.csv);
      validateFeed(rows, 'catalog');
      if (snapshot.count !== rows.length) throw new Error('invalid_snapshot');
      let galleries;
      if (snapshot.galleries !== undefined || snapshot.galleryRevision !== undefined) {
        if (!snapshot.galleries || typeof snapshot.galleries !== 'object' || Array.isArray(snapshot.galleries) ||
            Object.keys(snapshot.galleries).length !== rows.length || !HASH.test(snapshot.galleryRevision || '')) throw new Error('invalid_snapshot');
        galleries = Object.fromEntries(rows.map(item => {
          const photos = originalPhotoGallery(snapshot.galleries[item.id], item.image_link);
          if (!photos || JSON.stringify(photos) !== JSON.stringify(snapshot.galleries[item.id]) ||
              JSON.stringify(photos.slice(1, 21)) !== JSON.stringify(additionalStockPhotos(item))) throw new Error('invalid_snapshot');
          return [item.id, photos];
        }));
        const revision = createHash('sha256').update(JSON.stringify(Object.entries(galleries).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
        if (revision !== snapshot.galleryRevision) throw new Error('invalid_snapshot');
      }
      const items = rows.map(item => publicVehicle(item, galleries?.[item.id] || [item.image_link, ...additionalStockPhotos(item)]));
      const body = {
        ok: true, updatedAt: new Date(snapshot.checkedAt).toISOString(),
        revision: snapshot.galleryRevision ? createHash('sha256').update(`${snapshot.fingerprint}\n${snapshot.galleryRevision}`).digest('hex') : snapshot.fingerprint,
        total: items.length, items,
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
