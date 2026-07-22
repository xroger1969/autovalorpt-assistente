const STOCK_URL = process.env.STOCK_URL || 'https://spremium.standvirtual.com/inventory';
const CACHE_MS = 5 * 60 * 1000;
let memoryCache = { at: 0, items: [] };

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/gi, '€');
}

function stripHtml(value = '') {
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value = '') {
  try {
    return new URL(String(value).replace(/\\\//g, '/'), STOCK_URL).toString();
  } catch {
    return '';
  }
}

function isVehicleUrl(url = '') {
  return /standvirtual\.com/i.test(url)
    && !/\/inventory\/?(?:$|[?#])/i.test(url)
    && !/(privacy|privacidade|cookies|termos|reclamac)/i.test(url)
    && /(carros|anuncio|auto|id[0-9a-z])/i.test(url);
}

function attribute(source = '', name = '') {
  return (String(source).match(new RegExp(`${name}=["']([^"']+)["']`, 'i')) || [])[1] || '';
}

function titleCase(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/(^|\s)([a-záàâãéêíóôõúç])/g, (match, space, letter) => `${space}${letter.toUpperCase()}`)
    .replace(/\bMg\b/g, 'MG')
    .replace(/\bBmw\b/g, 'BMW')
    .replace(/\bVw\b/g, 'VW')
    .replace(/\bEv\b/g, 'EV')
    .replace(/\bAwd\b/g, 'AWD')
    .replace(/\bRwd\b/g, 'RWD')
    .replace(/\bKwh\b/g, 'kWh')
    .replace(/\bE Tron\b/g, 'e-tron')
    .replace(/\bS Line\b/g, 'S line');
}

function cleanTitle(value = '') {
  const title = stripHtml(value)
    .replace(/\s*[|–-]\s*Standvirtual.*$/i, '')
    .replace(/(?:[-_\s]+)?ID[0-9A-Z]+(?:\.html?)?\s*$/i, '')
    .replace(/\btra o\b/gi, 'tração')
    .replace(/\bel trico\b/gi, 'elétrico')
    .replace(/\bh brido\b/gi, 'híbrido')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title.length < 4 || title.length > 150) return '';
  if (/(privacy|privacidade|cookies|inventory|ver detalhes|livro de reclama)/i.test(title)) return '';
  return titleCase(title);
}

function titleFromUrl(url = '') {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    let raw = parts.at(-1) || '';
    if (/^id[0-9a-z]+/i.test(raw) && parts.length > 1) raw = parts.at(-2);
    return cleanTitle(decodeURIComponent(raw)
      .replace(/\.html?$/i, '')
      .replace(/(?:[-_])?ID[0-9a-z]+$/i, '')
      .replace(/^(anuncio|carros)[-_]?/i, '')
      .replace(/[-_]+/g, ' '));
  } catch {
    return '';
  }
}

function imageFromHtml(html = '') {
  const meta = String(html).match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)
    || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
  if (meta?.[1]) return absoluteUrl(meta[1]);

  const tags = String(html).match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const srcset = attribute(tag, 'srcset').split(',').pop()?.trim().split(/\s+/)[0] || '';
    const candidate = attribute(tag, 'data-src') || attribute(tag, 'data-lazy-src') || attribute(tag, 'src') || srcset;
    const url = absoluteUrl(candidate);
    if (url && !/(logo|icon|avatar|placeholder|sprite)/i.test(url)) return url;
  }
  return '';
}

function formatPrice(raw = '') {
  const source = String(raw).trim();
  let digits = source.replace(/[^\d]/g, '');
  if (!digits) return '';
  let number = Number(digits);
  if (/[,\.]\d{2}\s*(?:€|EUR)\b/i.test(source) && number > 500000) number = Math.round(number / 100);
  if (!number || number < 1000 || number > 500000) return '';
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0
  }).format(number);
}

function structuredPrice(raw = '') {
  const source = String(raw);
  const patterns = [
    /(?:property|itemprop)=["'](?:product:price:amount|price)["'][^>]*content=["'](\d{4,6}(?:[.,]\d{1,2})?)["']/i,
    /content=["'](\d{4,6}(?:[.,]\d{1,2})?)["'][^>]*(?:property|itemprop)=["'](?:product:price:amount|price)["']/i,
    /["'](?:price|priceAmount)["']\s*:\s*["']?(\d{4,6}(?:[.,]\d{1,2})?)["']?/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function metadata(text = '') {
  const raw = String(text);
  const clean = stripHtml(raw);
  const explicitPrice = (clean.match(/(?:€\s*\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?|\b\d{1,3}(?:[.\s]\d{3})+(?:,\d{2})?\s*(?:€|EUR)\b|\b\d{4,6}(?:,\d{2})?\s*(?:€|EUR)\b)/i) || [])[0] || '';
  const priceRaw = structuredPrice(raw) || explicitPrice;
  const year = (clean.match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
  const mileage = (clean.match(/\b\d{1,3}(?:[.\s]\d{3})*\s*(?:km|quil[oó]metros)\b/i) || [])[0] || '';
  const fuel = (clean.match(/\b(el[eé]trico|h[ií]brido plug-in|h[ií]brido|gasolina|diesel|gasóleo|GPL)\b/i) || [])[0] || '';
  return {
    price: formatPrice(priceRaw),
    year,
    mileage: mileage.replace(/quil[oó]metros/i, 'km'),
    fuel: fuel ? fuel.charAt(0).toUpperCase() + fuel.slice(1).toLowerCase() : ''
  };
}

function merge(base, next) {
  return {
    title: base.title || next.title,
    url: base.url || next.url,
    image: base.image || next.image,
    price: base.price || next.price,
    year: base.year || next.year,
    mileage: base.mileage || next.mileage,
    fuel: base.fuel || next.fuel
  };
}

function extractInventory(html = '') {
  const found = [];
  const anchorRegex = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const attrs = `${match[1]} ${match[3]}`;
    const inside = match[4];
    const url = absoluteUrl(match[2]);
    if (!isVehicleUrl(url)) continue;
    const title = cleanTitle(attribute(attrs, 'aria-label') || attribute(attrs, 'title') || inside) || titleFromUrl(url);
    if (!title) continue;
    found.push({ title, url, image: imageFromHtml(inside), ...metadata(inside) });
  }

  const escapedUrls = html.match(/https?:\\?\/\\?\/[^"'\\]+standvirtual[^"'\\]+/gi) || [];
  for (const raw of escapedUrls.slice(0, 500)) {
    const url = absoluteUrl(raw.replace(/\\u002F/g, '/'));
    if (!isVehicleUrl(url)) continue;
    const title = titleFromUrl(url);
    if (title) found.push({ title, url, image: '', price: '', year: '', mileage: '', fuel: '' });
  }

  const unique = new Map();
  for (const item of found) unique.set(item.url, unique.has(item.url) ? merge(unique.get(item.url), item) : item);
  return [...unique.values()].slice(0, 18);
}

async function fetchText(url, timeout = 7000) {
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

async function enrich(item) {
  if (item.image && item.price && item.year) return item;
  try {
    const html = await fetchText(item.url, 4500);
    if (!html) return item;
    const titleMeta = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    return merge(item, {
      title: cleanTitle(titleMeta),
      url: item.url,
      image: imageFromHtml(html),
      ...metadata(html)
    });
  } catch {
    return item;
  }
}

async function loadStock() {
  if (Date.now() - memoryCache.at < CACHE_MS && memoryCache.items.length) return memoryCache.items;
  const html = await fetchText(STOCK_URL);
  if (!html) return [];
  const base = extractInventory(html).slice(0, 12);
  const enriched = [];
  for (let index = 0; index < base.length; index += 4) {
    enriched.push(...await Promise.all(base.slice(index, index + 4).map(enrich)));
  }
  memoryCache = { at: Date.now(), items: enriched };
  return enriched;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  try {
    const items = await loadStock();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ source: STOCK_URL, results: items });
  } catch (error) {
    console.error('Falha ao consultar stock', error?.message);
    return res.status(200).json({ results: [], warning: 'Não foi possível consultar as viaturas neste momento.' });
  }
}
