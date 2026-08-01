import chatHandler from './chat.js';

const PHONE_PATTERN = /(?:(?:\+|00)?351[\s.-]*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}/;
const NAME_PATTERN = /^[A-Za-zÀ-ÿ'’\- ]{2,80}$/u;

export function normalizeContactOrder(value = '', lead = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || (lead?.nome && lead?.telefone)) return text;

  const match = text.match(PHONE_PATTERN);
  if (!match || match.index == null) return text;

  const before = text.slice(0, match.index).replace(/[,;|/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const after = text.slice(match.index + match[0].length)
    .replace(/^(?:[,;|/\\\s-]+|(?:nome|sou|chamo-me|chamo me)\s*[:=-]?\s*)+/i, '')
    .replace(/[,;|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/[A-Za-zÀ-ÿ]/u.test(before) || !after || !NAME_PATTERN.test(after)) return text;

  const words = after.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
  if (!words.length || words.length > 6) return text;

  return `${after} ${match[0]}`.trim();
}

export default async function handler(req, res) {
  if (req.method === 'GET' && req.query?.diagnostic === '1') {
    const samples = ['Rita 919776554', '919776554 Rita', '+351 919 776 554 Rita Ana'];
    return res.status(200).json({ samples: samples.map((message) => ({ message, normalized: normalizeContactOrder(message, {}) })) });
  }

  if (req.method === 'POST' && req.body?.message) {
    req.body = {
      ...req.body,
      message: normalizeContactOrder(req.body.message, req.body.lead || {})
    };
  }

  return chatHandler(req, res);
}
