import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPreparedCatalogSource, syncCatalogStock } from '../lib/catalog-photo-source.js';
import { createPublicCatalogFeed } from '../lib/stock-feed-handler.js';

const originalSamucar = 'https://ireland.apollo.olxcdn.com/v1/files/samucar/image';
const originalAutoValor = 'https://ireland.apollo.olxcdn.com/v1/files/autovalorpt/image';
const rawAudit = {
  valid: true, status: 'source_matches', sourceCount: 2, expectedCount: 2,
  feedHash: 'a'.repeat(64), feedUrl: 'https://example.test/original-feed.csv',
  items: [
    { id: 'ID8Q12345', image_link: originalSamucar },
    { id: 'ID8Q54321', image_link: originalAutoValor },
  ],
  sources: [
    { id: 'samucar', ids: ['ID8Q12345'] },
    { id: 'autovalorpt', ids: ['ID8Q54321'] },
  ],
};

test('catálogo inclui as duas contas e nunca substitui as fotos originais', async () => {
  let audits = 0; let syncs = 0; let preparationCalls = 0;
  const stockSource = {
    async audit() { audits++; return structuredClone(rawAudit); },
    async sync() { syncs++; return { valid: true }; },
    async feed(fingerprint) { return { csv: 'original:' + fingerprint }; },
  };
  const catalog = createPreparedCatalogSource({
    stockSource,
    preparePhoto() { preparationCalls++; throw Error('Image processing must never run'); },
  });
  const result = await syncCatalogStock(stockSource, catalog);
  assert.equal(result.valid, true);
  assert.equal(syncs, 1);
  assert.equal(audits, 1);
  assert.equal(preparationCalls, 0);
  assert.deepEqual(result.items.map(item => item.image_link), [originalSamucar, originalAutoValor]);
  assert.deepEqual(result.expectedImages, {
    ID8Q12345: originalSamucar, ID8Q54321: originalAutoValor,
  });
  assert.deepEqual(result.imageDiagnostics, [{ id: 'ID8Q54321', status: 'unchanged' }]);
  assert.deepEqual(result.preparedIds, []);
  const expectedHash = createHash('sha256').update(JSON.stringify([
    ['ID8Q12345', originalSamucar], ['ID8Q54321', originalAutoValor]
  ])).digest('hex');
  assert.equal(result.imageRevision, expectedHash);
  const checked = await catalog.audit();
  assert.deepEqual(checked.expectedImages, result.expectedImages);
});

test('o feed latest nunca recupera capas modificadas anteriormente', async () => {
  const requested = [];
  const raw = { async feed(id) { requested.push('raw:' + id); return { csv: 'raw:' + id }; } };
  const historical = { async feed(id) { requested.push('historical:' + id); return { csv: 'historical:' + id }; } };
  const feed = createPublicCatalogFeed({ stockSource: raw, catalogSource: historical });
  assert.deepEqual(await feed.feed('latest'), { csv: 'raw:latest' });
  assert.deepEqual(requested, ['raw:latest']);
  assert.deepEqual(await feed.feed('a'.repeat(64)), { csv: 'historical:' + 'a'.repeat(64) });
});
