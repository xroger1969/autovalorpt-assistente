import { createHash } from 'node:crypto';
import { STOCK_INVENTORIES } from './stock-inventories.js';

const sourceIds = STOCK_INVENTORIES.map(source => source.id);
const fail = code => Object.assign(new Error(code), { code });
const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const advertId = /^ID[A-Za-z0-9]{5,30}$/;

function identifiers(item) {
  const vin = String(item.vin || '').trim().toUpperCase();
  const plate = String(item.plate || '').trim().toUpperCase().replace(/[ .-]/g, '');
  return {
    vin: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) && !/^(.)\1+$/.test(vin) ? vin : '',
    plate: /^[A-Z0-9]{5,9}$/.test(plate) && /[A-Z]/.test(plate) && /\d/.test(plate) ? plate : '',
  };
}

function vehicle(item, memberships) {
  const sources = memberships.get(item.id);
  if (!advertId.test(item.id) || !sources?.length) throw fail('stock_selection_invalid');
  const titleParts = item.title.split(/\s+\|\s+/);
  const title = titleParts[0];
  const year = item.year ?? Number(titleParts[1]);
  const mileage = item.mileage ?? (/^[\d ]+ km$/i.test(titleParts[2] || '') ?
    Number(titleParts[2].replace(/\D/g, '')) : null);
  const brand = normalize(item.brand);
  const fullTitle = normalize(item.model || title);
  const modelWords = (fullTitle.startsWith(brand + ' ') ? fullTitle.slice(brand.length + 1) : fullTitle).split(' ');
  const model = ['classe', 'serie', 'model', 'range', 'land'].includes(modelWords[0]) ?
    modelWords.slice(0, 2).join(' ') : modelWords[0];
  const data = { id: item.id, title, price: item.price, year: Number.isSafeInteger(year) ? year : null,
    mileage: Number.isSafeInteger(mileage) ? mileage : null, sources, link: item.link, image: item.image ?? item.image_link };
  return { data, ...identifiers(item), modelKey: brand && model && data.year ? [brand, model, data.year].join('|') : '' };
}

// A plate shared by contradictory VINs cannot link a third advert to either car.
function exactKey(row, vinsByPlate) {
  if (row.vin) return 'vin:' + row.vin;
  if (!row.plate) return '';
  const vins = vinsByPlate.get(row.plate);
  if (vins?.size === 1) return 'vin:' + vins.values().next().value;
  return vins?.size > 1 ? '' : 'plate:' + row.plate;
}

function possibleMatch(left, right) {
  if (!left.data.sources.some(source => right.data.sources.some(other => source !== other))) return false;
  if (left.plate && left.plate === right.plate) return true;
  if ((left.vin && right.vin && left.vin !== right.vin) ||
      (left.plate && right.plate && left.plate !== right.plate)) return false;
  if (!left.modelKey || left.modelKey !== right.modelKey || left.data.mileage === null || right.data.mileage === null) return false;
  const kmTolerance = Math.min(5000, Math.max(1000, Math.min(left.data.mileage, right.data.mileage) * 0.03));
  return Math.abs(left.data.mileage - right.data.mileage) <= kmTolerance;
}

// Inputs are from the two validated inventories and the last committed catalogue.
// This function is read-only. Only its caller can commit the returned choices
// together with the new feed under the catalogue's conditional write.
export function stockSelectionReview(inventory, existingIds, ignoredIds = []) {
  const existing = new Set(existingIds), ignored = new Set(ignoredIds);
  const memberships = new Map();
  for (const source of inventory.sources) {
    if (!sourceIds.includes(source.id)) throw fail('stock_selection_invalid');
    for (const id of source.ids) {
      if (!memberships.has(id)) memberships.set(id, []);
      memberships.get(id).push(source.id);
    }
  }
  for (const values of memberships.values()) values.sort();
  const inventoryRows = inventory.items.map(item => vehicle(item, memberships));
  const vinsByPlate = new Map();
  for (const { vin, plate } of inventoryRows) {
    if (!vin || !plate) continue;
    if (!vinsByPlate.has(plate)) vinsByPlate.set(plate, new Set());
    vinsByPlate.get(plate).add(vin);
  }

  const rows = inventoryRows.filter(row => existing.has(row.data.id) || !ignored.has(row.data.id))
    .sort((a, b) => a.data.id.localeCompare(b.data.id));
  const groups = new Map();
  for (const row of rows) {
    row.key = exactKey(row, vinsByPlate);
    if (!row.key) continue;
    if (!groups.has(row.key)) groups.set(row.key, []);
    groups.get(row.key).push(row.data.id);
  }
  const pending = [], defaultIds = [], relatedIds = new Set();
  for (const row of rows) {
    const id = row.data.id;
    if (existing.has(id)) continue;
    const group = groups.get(row.key) || [id];
    const duplicateIds = group.filter(other => other !== id);
    const alreadyRepresented = duplicateIds.some(other => existing.has(other));
    // Sorting before grouping makes the proposed advert independent of source order.
    if (!alreadyRepresented && group[0] === id) defaultIds.push(id);
    const possibleDuplicateIds = [];
    for (const other of rows) {
      if (row === other || (row.key && row.key === other.key)) continue;
      if (possibleMatch(row, other)) {
        possibleDuplicateIds.push(other.data.id);
        if (possibleDuplicateIds.length >= 12) break;
      }
    }
    for (const other of [...duplicateIds, ...possibleDuplicateIds]) {
      if (existing.has(other)) relatedIds.add(other);
    }
    pending.push({ ...row.data, duplicateIds, possibleDuplicateIds, alreadyRepresented });
  }
  const related = rows.filter(row => relatedIds.has(row.data.id)).map(row => row.data);
  const revision = createHash('sha256').update(JSON.stringify([pending, defaultIds, related])).digest('hex');
  const approvedCount = rows.filter(row => existing.has(row.data.id)).length;
  return { revision, pending, defaultIds, related, approvedCount, sourceCount: inventory.items.length };
}

export function applyStockSelection(review, decision) {
  if (!decision || typeof decision.revision !== 'string' || !['all', 'choose'].includes(decision.mode))
    throw fail('stock_selection_invalid');
  if (decision.revision !== review.revision || !review.pending.length) throw fail('stock_selection_stale');
  if (decision.mode === 'all' && decision.selectedIds !== undefined) throw fail('stock_selection_invalid');
  const ids = decision.mode === 'all' ? review.defaultIds : decision.selectedIds;
  if (!Array.isArray(ids) || ids.length > review.pending.length) throw fail('stock_selection_invalid');
  const selected = new Set(ids);
  const pending = new Set(review.pending.map(row => row.id));
  if (selected.size !== ids.length || ids.some(id => !pending.has(id))) throw fail('stock_selection_invalid');
  for (const row of review.pending) {
    if (selected.has(row.id) && (row.alreadyRepresented || row.duplicateIds.some(id => selected.has(id))))
      throw fail('stock_selection_duplicate');
  }
  const pendingIds = [...pending];
  return { selectedIds: pendingIds.filter(id => selected.has(id)), ignoredIds: pendingIds.filter(id => !selected.has(id)) };
}
