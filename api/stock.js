const STOCK_URL = process.env.STOCK_URL || 'https://spremium.standvirtual.com/inventory';
const CACHE_MS = 60 * 1000;
const SOURCE_TIMEOUT_MS = 8500;
const ENRICH_TIMEOUT_MS = 2200;
const ENRICH_BUDGET_MS = 4800;
let memoryCache = { at: 0, items: [] };

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&euro;/gi, '€')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
      const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function absoluteUrl(value = '') {
  if (!String(value).trim()) return '';
  try {
    const url = new URL(decodeHtml(String(value)).replace(/\\\//g, '/'), STOCK_URL);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch { return ''; }
}

function isVehicleUrl(value = '') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'standvirtual.com' || url.hostname.endsWith('.standvirtual.com')) &&
      /\/anuncio\/[^/]+/i.test(url.pathname);
  } catch { return false; }
}

function attribute(source = '', name = '') {
  return (String(source).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] || '';
}

function titleCase(value = '') {
  return String(value).toLowerCase()
    .replace(/(^|\s)([a-záàâãéêíóôõúç])/g, (match, space, letter) => `${space}${letter.toUpperCase()}`)
    .replace(/\b(Mg|Bmw|Vw|Ev|Awd|Rwd|Gt|Gti|Gtd)\b/g, value => value.toUpperCase())
    .replace(/\bKwh\b/g, 'kWh').replace(/\bE Tron\b/g, 'e-tron').replace(/\bS Line\b/g, 'S line');
}

function cleanTitle(value = '') {
  const title = stripHtml(value)
    .replace(/\s*[|–-]\s*Standvirtual.*$/i, '')
    .replace(/(?:[-_\s]+)?ID[0-9A-Z]+(?:\.html?)?\s*$/i, '')
    .replace(/\btra o\b/gi, 'tração').replace(/\bel trico\b/gi, 'elétrico').replace(/\bh brido\b/gi, 'híbrido')
    .replace(/\s+/g, ' ').trim();
  if (!title || title.length < 4 || title.length > 150 || /(?:privacy|privacidade|cookies|inventory|ver detalhes|livro de reclama)/i.test(title)) return '';
  return title;
}

function titleFromUrl(url = '') {
  try {
    const raw = new URL(url).pathname.split('/').filter(Boolean).at(-1) || '';
    return titleCase(cleanTitle(decodeURIComponent(raw).replace(/\.html?$/i, '')
      .replace(/(?:[-_])?ID[0-9a-z]+$/i, '').replace(/[-_]+/g, ' ')));
  } catch { return ''; }
}

function imageFromHtml(html = '') {
  const metas = String(html).match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metas) {
    if (/^(?:og:image|twitter:image)$/.test(attribute(tag, 'property') || attribute(tag, 'name'))) {
      const image = absoluteUrl(attribute(tag, 'content'));
      if (image) return image;
    }
  }
  for (const tag of String(html).match(/<img\b[^>]*>/gi) || []) {
    const srcset = attribute(tag, 'srcset').split(',').pop()?.trim().split(/\s+/)[0] || '';
    const url = absoluteUrl(attribute(tag, 'data-src') || attribute(tag, 'data-lazy-src') || attribute(tag, 'src') || srcset);
    if (url && !/(logo|icon|avatar|placeholder|sprite)/i.test(url)) return url;
  }
  return '';
}

function numericAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? '').replace(/(?:EUR|€)/gi, '').replace(/[\s\u00a0\u202f]/g, '').trim();
  if (!/^\d+(?:[.,]\d+)*$/.test(text)) return NaN;
  const decimal = text.match(/[.,](\d{1,2})$/);
  if (decimal) {
    const offset = text.length - decimal[0].length;
    text = `${text.slice(0, offset).replace(/[.,]/g, '')}.${decimal[1]}`;
  } else {
    text = text.replace(/[.,]/g, '');
  }
  return Number(text);
}

function formatPrice(value) {
  const number = numericAmount(value);
  return Number.isFinite(number) && number >= 1000 && number <= 500000
    ? new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(number) : '';
}

function validYear(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^((?:19|20)\d{2})(?:-\d{2}(?:-\d{2})?)?$/);
  return match && Number(match[1]) >= 1900 && Number(match[1]) <= new Date().getUTCFullYear() + 1 ? match[1] : '';
}

function formatMileage(value) {
  const text = String(value ?? '').replace(/(?:km|quil[oó]metros)/gi, '').trim();
  if (!/^\d{1,7}$|^\d{1,3}(?:[.\s\u00a0\u202f]\d{3})+$/.test(text)) return '';
  const number = Number(text.replace(/[.\s\u00a0\u202f]/g, ''));
  return Number.isSafeInteger(number) && number >= 0 && number <= 2_000_000
    ? `${new Intl.NumberFormat('pt-PT').format(number)} km` : '';
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function nextPageProps(html) {
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attribute(match[1], 'id') === '__NEXT_DATA__') return parseJson(match[2])?.props?.pageProps || {};
  }
  return {};
}

function jsonLdVehicles(html) {
  const found = [];
  function visit(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 8) return;
    if (Array.isArray(node)) { node.slice(0, 200).forEach(item => visit(item, depth + 1)); return; }
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (types.some(type => ['Car', 'Vehicle', 'Product'].includes(type)) && (node.url || node['@id'])) found.push(node);
    // Only schema containers, never arbitrary recommendations or seller objects.
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) if (node[key]) visit(node[key], depth + 1);
  }
  for (const match of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attribute(match[1], 'type') === 'application/ld+json') visit(parseJson(match[2]));
  }
  return found;
}

function adAttribute(ad, ...keys) {
  for (const key of keys) {
    const attribute = [...(Array.isArray(ad.attributes) ? ad.attributes : []), ...(Array.isArray(ad.details) ? ad.details : [])]
      .find(item => item?.key === key);
    if (attribute) return attribute.valueLabel || attribute.value || '';
    const parameter = ad.parametersDict?.[key]?.values?.[0];
    if (parameter) return parameter.label || parameter.value || '';
  }
  return '';
}

function fromStructuredAd(ad = {}) {
  const url = absoluteUrl(ad.url || ad['@id'] || '');
  if (!isVehicleUrl(url)) return null;
  const title = cleanTitle(ad.title || ad.name) || titleFromUrl(url);
  if (!title) return null;
  const price = ad.price;
  const offer = Array.isArray(ad.offers) ? ad.offers[0] : ad.offers;
  const currency = price?.currencyCode || price?.currency || offer?.priceCurrency || 'EUR';
  const amount = Number.isFinite(price?.grossMinorAmount) ? price.grossMinorAmount / 100
    : price?.value ?? offer?.price ?? (typeof price !== 'object' ? price : '');
  const image = ad.photos?.[0] || ad.images?.photos?.[0]?.url || (Array.isArray(ad.image) ? ad.image[0] : ad.image);
  const odometer = ad.mileageFromOdometer;
  const kilometres = !odometer?.unitCode || /^(?:KMT|KM)$/i.test(String(odometer.unitCode));
  const mileage = adAttribute(ad, 'mileage') || (kilometres ? odometer?.value : '');
  return {
    title, url,
    image: absoluteUrl(typeof image === 'string' ? image : image?.url || ''),
    price: currency === 'EUR' ? formatPrice(amount) : '',
    year: validYear(adAttribute(ad, 'first_registration_year', 'year', 'production_year') || ad.vehicleModelDate || ad.productionDate),
    mileage: formatMileage(mileage),
    fuel: stripHtml(adAttribute(ad, 'fuel_type') || ad.fuelType || '').slice(0, 60),
    _reliableTitle: true
  };
}

function structuredInventory(html) {
  const props = nextPageProps(html);
  const ads = [];
  for (const entry of Object.values(props.urqlState || {})) {
    const data = typeof entry?.data === 'string' ? parseJson(entry.data) : entry?.data;
    if (Array.isArray(data?.publishedAds?.ads)) ads.push(...data.publishedAds.ads);
  }
  ads.push(...jsonLdVehicles(html));
  return ads.map(fromStructuredAd).filter(Boolean);
}

function metadata(html = '', { card = false } = {}) {
  const raw = String(html);
  const visible = stripHtml(raw);
  const explicitPrice = (visible.match(/(?:€\s*\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?\s*(?:€|EUR)(?!\w)|\b\d{4,6}(?:,\d{2})?\s*(?:€|EUR)(?!\w))/i) || [])[0] || '';
  let price = '';
  for (const tag of raw.match(/<meta\b[^>]*>/gi) || []) {
    if (/^(?:product:price:amount|price)$/.test(attribute(tag, 'property') || attribute(tag, 'itemprop'))) price = formatPrice(attribute(tag, 'content'));
  }
  // A four-digit model name (e.g. Peugeot 2008) is not a registration year.
  // Read labelled data or the month/year pair used by Standvirtual's cards.
  const labelledYear = visible.match(/\b(?:ano(?:\s+de\s+(?:registo|fabrico))?|primeiro\s+registo)\s*:?\s*(?:(?:0?[1-9]|1[0-2])\/)?((?:19|20)\d{2})\b/i)?.[1];
  const datedYear = visible.match(/\b(?:janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+(?:de\s+)?((?:19|20)\d{2})\b/i)?.[1];
  const labelledMileage = visible.match(/\bquil[oó]metros\s*:?\s*(\d{1,7}|\d{1,3}(?:[.\s]\d{3})+)\s*km\b/i)?.[1];
  const cardMileage = card ? visible.match(/\b(?:\d{1,3}(?:[.\s]\d{3})+|\d{1,7})\s*km\b/i)?.[0] : '';
  const fuel = visible.match(/\b(el[eé]trico|h[ií]brido plug-in|h[ií]brido|gasolina|diesel|gasóleo|GPL)\b/i)?.[0] || '';
  return { price: price || formatPrice(explicitPrice), year: validYear(labelledYear || datedYear), mileage: formatMileage(labelledMileage || cardMileage), fuel };
}

function merge(base = {}, next = {}) {
  return {
    title: (!base._reliableTitle && next._reliableTitle ? next.title : base.title) || next.title || '',
    url: base.url || next.url || '', image: base.image || next.image || '',
    price: base.price || next.price || '', year: base.year || next.year || '',
    mileage: base.mileage || next.mileage || '', fuel: base.fuel || next.fuel || '',
    _reliableTitle: Boolean(base._reliableTitle || next._reliableTitle)
  };
}

function publicItem(item) {
  const { _reliableTitle, ...data } = item;
  return data;
}

export function extractInventory(html = '') {
  const found = structuredInventory(html);
  for (const match of String(html).matchAll(/<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = `${match[1]} ${match[3]}`;
    const inside = match[4];
    const url = absoluteUrl(match[2]);
    if (!isVehicleUrl(url)) continue;
    const heading = inside.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] || '';
    const label = cleanTitle(heading || attribute(attrs, 'aria-label') || attribute(attrs, 'title'));
    const reliableTitle = label && !/\b\d[\d\s.,]*\s*(?:km|EUR)\b|€/i.test(label) ? label : '';
    const title = reliableTitle || titleFromUrl(url);
    if (title) found.push({ title, url, image: imageFromHtml(inside), ...metadata(inside, { card: true }), _reliableTitle: Boolean(reliableTitle) });
  }
  const unique = new Map();
  for (const item of found) unique.set(item.url, unique.has(item.url) ? merge(unique.get(item.url), item) : item);
  return [...unique.values()].map(publicItem);
}

export function extractVehicleDetails(html = '', expectedUrl = '') {
  const props = nextPageProps(html);
  const candidates = [props.advert, ...jsonLdVehicles(html)].filter(Boolean).map(fromStructuredAd).filter(Boolean);
  const wanted = absoluteUrl(expectedUrl);
  const structured = candidates.find(item => !wanted || item.url === wanted) || {};
  if (wanted && candidates.length && !structured.url) {
    // A sold advert may redirect to a different vehicle. Never copy its data.
    return publicItem(merge({ url: wanted }, {}));
  }
  const title = cleanTitle(String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  return publicItem(merge(structured, { title, url: wanted, image: imageFromHtml(html), ...metadata(html), _reliableTitle: Boolean(title) }));
}
async function fetchText(url, timeout = SOURCE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 AutoValorPT-assistente',
        accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });
    return response.ok ? await response.text() : '';
  } finally {
    clearTimeout(timer);
  }
}

async function enrich(item, timeout = ENRICH_TIMEOUT_MS) {
  if (item.image && item.price && item.year) return item;
  try {
    const html = await fetchText(item.url, timeout);
    if (!html) return item;
    // The advert's explicit fields take precedence over card fallbacks.
    return publicItem(merge(extractVehicleDetails(html, item.url), item));
  } catch {
    return item;
  }
}

async function enrichWithinBudget(base = [], budgetMs = ENRICH_BUDGET_MS) {
  const results = [];
  const deadline = Date.now() + budgetMs;
  const chunkSize = 6;

  for (let index = 0; index < base.length; index += chunkSize) {
    const remaining = deadline - Date.now();
    if (remaining < 350) {
      results.push(...base.slice(index));
      break;
    }
    const timeout = Math.max(350, Math.min(ENRICH_TIMEOUT_MS, remaining));
    const chunk = base.slice(index, index + chunkSize);
    results.push(...await Promise.all(chunk.map((item) => enrich(item, timeout))));
  }

  return results.length === base.length ? results : [...results, ...base.slice(results.length)];
}

async function loadStock() {
  const cachedItems = memoryCache.items;
  if (Date.now() - memoryCache.at < CACHE_MS && cachedItems.length) return { items: cachedItems, stale: false };

  let html = '';
  try {
    html = await fetchText(STOCK_URL, SOURCE_TIMEOUT_MS);
  } catch (error) {
    console.warn('stock_source_unreachable', error?.message || error);
  }

  if (!html) return { items: cachedItems, stale: Boolean(cachedItems.length) };
  const base = extractInventory(html);
  if (!base.length) return { items: cachedItems, stale: Boolean(cachedItems.length) };

  const enriched = await enrichWithinBudget(base);
  memoryCache = { at: Date.now(), items: enriched };
  return { items: enriched, stale: false };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  try {
    const { items, stale } = await loadStock();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      source: STOCK_URL,
      results: items,
      ...(stale ? { warning: 'Foi apresentada a última versão disponível do stock enquanto a origem é atualizada.' } : {})
    });
  } catch (error) {
    console.error('Falha ao consultar stock', error?.message);
    const fallbackItems = memoryCache.items || [];
    return res.status(200).json({
      results: fallbackItems,
      warning: fallbackItems.length
        ? 'Foi apresentada a última versão disponível do stock enquanto a origem é atualizada.'
        : 'Não foi possível consultar as viaturas neste momento.'
    });
  }
}
