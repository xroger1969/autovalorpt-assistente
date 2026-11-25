import { readStockInventories } from './meta-catalog-source.js';

const CACHE_MS = 60_000;
let snapshot;
let loading;

// Both public views use one complete read of the authorised inventories.
// A verified empty list is cacheable. A failed or partial read is never cached.
export async function readPublicInventory() {
  if (snapshot && Date.now() - snapshot.checkedAt < CACHE_MS) return snapshot;
  if (!loading) {
    loading = readStockInventories({ timeoutMs: 8500, publicListing: true }).then(inventory => {
      snapshot = { ...inventory, checkedAt: Date.now() };
      return snapshot;
    }).finally(() => { loading = null; });
  }
  return loading;
}

const electricLabels = new Set(['eletrico', 'electrico', '100% eletrico', '100% electrico', 'electric', '100% electric', 'bev']);
function batteryElectric({ fuel, fuelCode }) {
  const label = fuel.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();
  // A title mentioning “electric” is insufficient. Standvirtual's two
  // structured fuel fields must agree, even for cars from a known EV brand.
  return fuelCode === 'electric' && electricLabels.has(label);
}

export async function handleElectricStock(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const { items, sources, checkedAt } = await readPublicInventory();
    const sourceNames = new Map();
    for (const source of sources) {
      for (const id of source.ids) sourceNames.set(id, [...(sourceNames.get(id) || []), source.name]);
    }
    const vehicles = items.filter(batteryElectric).map(item => ({
      id: item.id, title: item.title, brand: item.brand, year: item.year, mileage: item.mileage,
      price: Number(item.price.split(' ')[0]), fuel: item.fuel, image: `${item.image};s=960x0`,
      url: item.link, sources: sourceNames.get(item.id),
    }));
    const ttl = Math.max(0, Math.floor((CACHE_MS - (Date.now() - checkedAt)) / 1000));
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${ttl}, must-revalidate`);
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).json({ ok: true, checkedAt: new Date(checkedAt).toISOString(), items: vehicles });
  } catch {
    return res.status(503).json({ ok: false, error: 'electric_stock_unavailable' });
  }
}
