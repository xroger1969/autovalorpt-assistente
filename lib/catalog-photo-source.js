import { createHash } from 'node:crypto';
import { createStockSource } from './stock-source.js';
import { additionalStockPhotos } from './stock-photos.js';

// Keep the two authorised Standvirtual inventories and all their original
// picture URLs. Never process a vehicle image, add a background or reuse an
// older prepared catalogue cover.
export function createPreparedCatalogSource(options = {}) {
  const stockSource = options.stockSource || createStockSource(options);

  async function audit(input = {}) {
    const original = await stockSource.audit(input);
    if (original?.valid !== true) return original;

    const expectedImages = Object.fromEntries(original.items.map(item => [item.id, item.image_link]));
    const expectedAdditionalImages = Object.fromEntries(original.items.map(item => [item.id, additionalStockPhotos(item)]));
    const additionalImageRevision = createHash('sha256').update(JSON.stringify(
      Object.entries(expectedAdditionalImages).sort(([a], [b]) => a.localeCompare(b))
    )).digest('hex');
    const imageRevision = createHash('sha256').update(JSON.stringify(
      Object.entries(expectedImages).sort(([a], [b]) => a.localeCompare(b))
    )).digest('hex');
    const ownIds = new Set(original.sources?.find(source => source.id === 'autovalorpt')?.ids || []);
    const imageDiagnostics = original.items.filter(item => ownIds.has(item.id))
      .map(item => ({ id: item.id, status: 'unchanged' }));

    const feedUrl = original.feedUrl?.startsWith('https://autovalorpt-assistente.vercel.app/api/stock?integration=stock-feed&snapshot=')
      ? `${original.feedUrl}&format=xml` : original.feedUrl;
    return { ...original, feedUrl, snapshotUrl: feedUrl, expectedImages, imageRevision, expectedAdditionalImages, additionalImageRevision,
      sourceOriginals: expectedImages, imageDiagnostics,
      imageSummary: { prepared: 0, unchanged: imageDiagnostics.length, pending: 0, review_required: 0, failed: 0 },
      preparedIds: [] };
  }

  return { audit, prepare: () => audit(), feed: stockSource.feed };
}

// A manual catalogue refresh and the normal daily flow continue to sync BOTH
// accounts. Image processing is intentionally not part of either path.
export async function syncCatalogStock(stockSource, catalogSource, input) {
  const result = await stockSource.sync(input);
  return result.valid === true ? catalogSource.prepare() : result;
}
