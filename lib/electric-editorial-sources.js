const INDEX_URL = 'https://www.acp.pt/o-clube/revista-acp/atualidade';
const DETAIL_URL = /^(?:https:\/\/www\.acp\.pt)?(\/o-clube\/revista-acp\/atualidade\/detalhe\/[a-z0-9]+(?:-[a-z0-9]+)*)$/;
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MAX_BYTES = 768 * 1024;
const DAY_MS = 86400000;
const ENTITIES = { amp: '&', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…' };

function validDay(date) {
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date)) return false;
  const stamp = Date.parse(date);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date;
}

function articleDate(text) {
  const parts = /^(\d{1,2})\s+(\p{L}+)\s+(20\d\d)$/u.exec(text.trim().toLowerCase());
  if (!parts) return null;
  const month = MONTHS.indexOf(parts[2]) + 1;
  const day = parts[3] + '-' + String(month).padStart(2, '0') + '-' + parts[1].padStart(2, '0');
  return validDay(day) ? day : null;
}

function plainText(raw, limit) {
  if (!raw || raw.length > limit * 8 || /[<>]/.test(raw)) return '';
  const value = raw.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (entity, name) => {
    if (name[0] !== '#') return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : entity;
    const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '\ufffd';
  }).trim().replace(/\s+/g, ' ');
  return value.length <= limit && !/[<>{}\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufffd]|&(?:#\w+|[a-z]+);/i.test(value) ? value : '';
}

// ACP mixes motoring news with sport and travel. Look for electric mobility
// in the visible headline or excerpt, not images, navigation or article slugs.
function isElectric(text) {
  const s = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(?:phev|bev|plug[ -]?in|100\s*%\s*eletric[oa]s?|mobilidade eletrica|eletromobilidade|travagem regenerativa|(?:veiculos?|carros?|automove(?:l|is)|suvs?|carrinhas?|furgoes|furgao|utilitarios?|motores?|propulsao|motorizac(?:ao|oes)) (?:[a-z]+ )?(?:eletric[oa]s?|hibrid[oa]s?)|(?:postos?|pontos?|redes?|estacoes|estacao) de (?:recarga|carregamento))\b/.test(s);
}

function newestArticle(html, date) {
  // Ignore non-visible template cards, tracking scripts and HTML comments.
  const visible = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const columns = /<div\s+class=["']news-columns["']\s*>/i.exec(visible);
  if (!columns) return null;
  const listing = visible.slice(columns.index + columns[0].length).split(/<div\s+class=["']pagination["']\s*>/i, 1)[0];
  const cards = listing.split(/<div\s+class=["']big-item["']\s*>/i).slice(1);
  const end = Date.parse(date);
  let newest = null;
  for (const card of cards) {
    const anchor = /^\s*<a\s+href=(["'])([^"'\s<>]+)\1\s*>([\s\S]*?)<\/a\s*>/i.exec(card);
    const path = anchor && DETAIL_URL.exec(anchor[2])?.[1];
    if (!path || path.length > 320) continue;
    const fields = /<time>\s*([^<]+?)\s*<\/time>\s*<h4>([^<]+)<\/h4>(?:\s*<p>([^<]*)<\/p>)?/i.exec(anchor[3]);
    if (!fields) continue;
    const published = articleDate(fields[1]);
    if (!published || published > date || end - Date.parse(published) >= 14 * DAY_MS || newest && newest.date >= published) continue;
    const title = plainText(fields[2], 200);
    if (!title || !isElectric(title + ' ' + plainText(fields[3], 600))) continue;
    newest = { title, date: published, url: 'https://www.acp.pt' + path };
  }
  return newest;
}

export async function readAcpElectricNews({ date, fetchImpl = fetch }) {
  if (!validDay(date)) return null;
  try {
    const response = await fetchImpl(INDEX_URL, { redirect: 'error', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(7000) });
    if (!response.body) return null;
    if (response.status !== 200 || response.url && response.url !== INDEX_URL || !/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') || '') ||
        Number(response.headers.get('content-length') || 0) > MAX_BYTES) {
      await response.body.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) return null;
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return newestArticle(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), date);
  } catch { return null; }
}
