import { createStockSource } from './stock-source.js';
import { createCatalogSource } from './catalog-feed.js';
import { createCatalogPhotoPreparer, CATALOG_BACKGROUND_VERSION, CATALOG_PHOTO_MODEL_VERSION } from './catalog-photo-preparer.js';

// Only the private synchronisation path provides a processor. Public feed and
// image readers instantiate read-only services without this callback.
export function createPreparedCatalogSource(options = {}) {
  return createCatalogSource({ ...options,
    stockSource: options.stockSource || createStockSource(options),
    backgroundVersion: CATALOG_BACKGROUND_VERSION,
    modelVersion: CATALOG_PHOTO_MODEL_VERSION,
    preparePhoto: options.preparePhoto || createCatalogPhotoPreparer(options),
  });
}

export async function syncCatalogStock(stockSource, catalogSource, input) {
  const result = await stockSource.sync(input);
  return result.valid === true ? catalogSource.prepare() : result;
}
