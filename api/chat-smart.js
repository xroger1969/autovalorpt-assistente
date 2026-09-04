import '../validation-core.js';
import chatHandler from './chat.js';

const ALLOWED_LEAD_FIELDS = ['nome', 'telefone', 'viatura', 'financiamento', 'retoma', 'matricula', 'visita', 'observacoes'];
const STRUCTURED_INTENTS = new Set(['financiamento', 'retoma', 'visita']);

function clean(value = '', max = 500) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function safeLead(input = {}) {
  const lead = {};
  for (const field of ALLOWED_LEAD_FIELDS) lead[field] = clean(input?.[field], field === 'observacoes' ? 500 : 180);
  return lead;
}

export function normalizeContactOrder(value = '', lead = {}) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || (lead?.nome && lead?.telefone)) return text;

  const parser = globalThis.AutoValorValidation?.extractFlexibleContact;
  const parsed = parser ? parser(text) : { nome: '', telefone: '' };
  if (parsed.nome && parsed.telefone) return `${parsed.nome} ${parsed.telefone}`;
  if (lead?.nome && parsed.telefone) return `${clean(lead.nome, 80)} ${parsed.telefone}`;
  return text;
}

export function validateStructuredMessage(message = '', intent = '') {
  if (!STRUCTURED_INTENTS.has(intent)) return { ok: true, normalized: String(message), retry: '' };
  const validator = globalThis.AutoValorValidation?.validateIntent;
  if (!validator) return { ok: true, normalized: String(message), retry: '' };
  return validator(intent, message);
}

export default async function handler(req, res) {
  if (req.method === 'POST' && req.body?.message) {
    const lead = req.body.lead || {};
    const intent = String(req.body.intent || '');
    let message = normalizeContactOrder(req.body.message, lead);

    if (STRUCTURED_INTENTS.has(intent)) {
      const validation = validateStructuredMessage(message, intent);
      if (!validation.ok) {
        return res.status(200).json({
          reply: validation.retry || 'Falta completar esta informação.',
          lead: safeLead(lead)
        });
      }
      if (validation.normalized) message = validation.normalized;
    }

    req.body = { ...req.body, message };
  }

  return chatHandler(req, res);
}
