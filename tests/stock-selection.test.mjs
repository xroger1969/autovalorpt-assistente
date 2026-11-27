import test from 'node:test';
import assert from 'node:assert/strict';
import { stockSelectionReview, applyStockSelection } from '../lib/stock-selection.js';

const vinA = 'WAUZZZ8V2GA123456', vinB = 'WAUZZZ8V2GA654321';
const first = 'ID8sellerA', second = 'ID8sellerB', third = 'ID8sellerC';
function car(id, source, overrides = {}) {
  return { id, source, title: 'Audi A3 Sportback', brand: 'Audi', year: 2020, mileage: 52000,
    price: '16990.00 EUR', link: 'https://www.standvirtual.com/carros/anuncio/' + id,
    image: 'https://images.example/' + id, ...overrides };
}
function inventory(...rows) {
  const byId = new Map(rows.map(({ source, ...item }) => [item.id, item]));
  return { items: [...byId.values()], sources: ['samucar', 'autovalorpt'].map(id =>
    ({ id, ids: rows.filter(row => row.source === id).map(row => row.id) })) };
}
const apply = (review, mode, selectedIds) => applyStockSelection(review, { revision: review.revision, mode,
  ...(selectedIds === undefined ? {} : { selectedIds }) });

test('equal listing IDs occur once, confirmed duplicate listings keep a chosen advert and its original photo', () => {
  const a = car(first, 'samucar', { plate: 'AB-12-CD' }), b = car(second, 'autovalorpt', { plate: 'ab 12 cd' });
  const shared = inventory(a, { ...a, source: 'autovalorpt' });
  const sharedReview = stockSelectionReview(shared, []);
  assert.equal(sharedReview.pending.length, 1);
  assert.deepEqual(sharedReview.pending[0].sources, ['autovalorpt', 'samucar']);
  assert.deepEqual(apply(sharedReview, 'all'), { selectedIds: [first], ignoredIds: [] });
  const review = stockSelectionReview(inventory(a, b), []);
  assert.equal(review.pending.length, 2);
  assert.deepEqual(review.pending[0].duplicateIds, [second]);
  assert.deepEqual(apply(review, 'all'), { selectedIds: [first], ignoredIds: [second] });
  assert.deepEqual(apply(review, 'choose', [second]), { selectedIds: [second], ignoredIds: [first] });
  assert.equal(review.pending[1].image, b.image);
  assert.throws(() => apply(review, 'choose', [first, second]), { code: 'stock_selection_duplicate' });
  assert.deepEqual(apply(review, 'choose', []), { selectedIds: [], ignoredIds: [first, second] });
  assert.equal(review.revision, stockSelectionReview(inventory(b, a), []).revision);
});

test('an approved duplicate keeps its catalogue identity and unrelated selective exclusions persist on refresh', () => {
  const current = inventory(car(first, 'samucar', { vin: vinA }), car(second, 'autovalorpt', { vin: vinA }),
    car(third, 'samucar', { title: 'Audi Q5', mileage: 14500 }));
  const review = stockSelectionReview(current, new Set([second]), [third]);
  assert.equal(review.pending[0].alreadyRepresented, true);
  assert.equal(review.approvedCount, 1);
  assert.equal(review.sourceCount, 3);
  assert.deepEqual(review.related.map(row => row.id), [second]);
  assert.deepEqual(apply(review, 'all'), { selectedIds: [], ignoredIds: [first] });
  assert.throws(() => apply(review, 'choose', [first]), { code: 'stock_selection_duplicate' });
  const reread = stockSelectionReview(current, [second], [first, third]);
  assert.equal(reread.pending.length, 0);
  assert.throws(() => applyStockSelection(reread, {revision: review.revision, mode: 'all'}), { code: 'stock_selection_stale' });
});

test('similar listings and shared generic photos remain independently selectable, including alongside approved vehicles', () => {
  const a = car(first, 'samucar', { model: 'A3', plate: 'SIM' });
  const b = car(second, 'autovalorpt', { title: 'Audi A3 S line', mileage: 52100, image: a.image, plate: 'SIM' });
  const c = car(third, 'autovalorpt', { title: 'Audi Q5', image: a.image });
  const current = inventory(a, b, c);
  const review = stockSelectionReview(current, []);
  assert.deepEqual(review.pending[0].duplicateIds, []);
  assert.deepEqual(review.pending[0].possibleDuplicateIds, [second]);
  assert.deepEqual(apply(review, 'all').selectedIds, [first, second, third]);
  const subsequent = stockSelectionReview(current, [first], []);
  assert.deepEqual(subsequent.pending[0].possibleDuplicateIds, [first]);
  assert.deepEqual(subsequent.related.map(row => row.id), [first]);
});

test('a plate-only advert cannot link conflicting VINs, but can join one unambiguous VIN', () => {
  const a = car(first, 'samucar', { plate: 'AB12CD', vin: vinA });
  const b = car(second, 'autovalorpt', { plate: 'AB12CD' });
  const c = car(third, 'samucar', { plate: 'AB12CD', vin: vinB });
  let review = stockSelectionReview(inventory(a, b, c), []);
  assert.ok(review.pending.every(row => row.duplicateIds.length === 0));
  assert.deepEqual(review.pending[1].possibleDuplicateIds, [first, third]);
  assert.deepEqual(apply(review, 'all').selectedIds, [first, second, third]);
  const priorChoice = stockSelectionReview(inventory(a, b, c), [first], [third]);
  assert.equal(priorChoice.pending[0].alreadyRepresented, false);
  assert.deepEqual(priorChoice.pending[0].possibleDuplicateIds, [first]);
  review = stockSelectionReview(inventory(a, b, { ...c, vin: vinA, plate: undefined }), []);
  assert.deepEqual(review.pending[1].duplicateIds, [first, third]);
  assert.deepEqual(apply(review, 'all').selectedIds, [first]);
});

test('stale or malformed decisions cannot accept a changed, hidden, or unrelated advert', () => {
  const a = car(first, 'samucar'), b = car(second, 'autovalorpt');
  const seen = stockSelectionReview(inventory(a), []);
  for (const current of [inventory(a,b), inventory({ ...a, price: '19990.00 EUR' }), inventory({ ...a, image: 'new' })]) {
    const updated = stockSelectionReview(current, []);
    assert.throws(() => applyStockSelection(updated, { revision: seen.revision, mode: 'all' }), { code: 'stock_selection_stale' });
  }
  for (const unknown of [[second], [first, first], null, undefined]) {
    assert.throws(() => apply(seen, 'choose', unknown), { code: 'stock_selection_invalid' });
  }
  assert.throws(() => apply(seen, 'all', [first]), { code: 'stock_selection_invalid' });
});
