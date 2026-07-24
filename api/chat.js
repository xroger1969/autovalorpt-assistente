const ALLOWED_FIELDS = ['nome', 'telefone', 'viatura', 'financiamento', 'retoma', 'visita', 'observacoes'];
const ALLOWED_INTENTS = new Set(['disponibilidade', 'financiamento', 'retoma', 'visita']);

const EMPTY_LEAD = Object.freeze({
  nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', visita: '', observacoes: ''
});

const SYSTEM_PROMPT = `És o assistente comercial da AutoValorPT e apoias Carlos Vasconcelos na venda de automóveis usados em Portugal.
Responde primeiro à dúvida de forma natural e útil, em português de Portugal.
Nunca confirmes disponibilidade, reserva, venda, marcação, valor de retoma, aprovação de crédito, prestação, garantia, equipamento, histórico, estado mecânico, saúde da bateria ou autonomia concreta sem confirmação do Carlos.
Quando existir uma intenção escolhida, organiza apenas os dados dessa intenção:
- financiamento: entrada e prazo ou mensalidade;
- retoma: marca, modelo, ano e quilómetros;
- visita: dia e horário;
- disponibilidade: pedido de confirmação.
Não peças nem guardes NIF, IBAN, documentos, cartões, palavras-passe ou códigos.
Usa duas a quatro frases curtas e no máximo uma pergunta de seguimento.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta: { type: 'string' },
    dados: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(ALLOWED_FIELDS.map((field) => [field, { type: 'string' }])),
      required: ALLOWED_FIELDS
    },
    precisa_humano: { type: 'boolean' },
    interesse_real: { type: 'boolean' }
  },
  required: ['resposta', 'dados', 'precisa_humano', 'interesse_real']
};

function clean(value = '', max = 500) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function redactForbidden(value = '') {
  return String(value)
    .replace(/\b(NIF|contribuinte)\b\s*[:\-]?\s*\d{9}\b/gi, '[NIF removido]')
    .replace(/\bIBAN\b\s*[:\-]?\s*[A-Z]{2}\d{2}[A-Z0-9\s]{11,30}\b/gi, '[IBAN removido]')
    .replace(/\b(cart[aã]o de cidad[aã]o|CC)\b\s*[:\-]?\s*[A-Z0-9\-\s]{6,25}/gi, '[documento removido]')
    .replace(/\b(password|senha|palavra-passe|c[oó]digo)\b\s*[:\-]?\s*\S+/gi, '[credencial removida]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[cartão removido]');
}

function sanitizeLead(input = {}) {
  const lead = { ...EMPTY_LEAD };
  for (const field of ALLOWED_FIELDS) {
    lead[field] = clean(redactForbidden(input?.[field]), field === 'observacoes' ? 500 : 180);
  }
  return lead;
}

function mergeLead(base = {}, incoming = {}) {
  const result = sanitizeLead(base);
  const next = sanitizeLead(incoming);
  for (const field of ALLOWED_FIELDS) if (next[field]) result[field] = next[field];
  return result;
}

function extractPhone(value = '') {
  const match = String(value).match(/(?:\+?351[\s.-]*)?(9\d{2}[\s.-]*\d{3}[\s.-]*\d{3})/);
  return match ? match[1].replace(/\D/g, '') : '';
}

function formatName(value = '') {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return String(value).trim().replace(/\s+/g, ' ').split(' ').map((word, index) => {
    const lower = word.toLocaleLowerCase('pt-PT');
    if (index > 0 && particles.has(lower)) return lower;
    return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
  }).join(' ');
}

function extractName(value = '', phone = '') {
  if (!phone) return '';
  const phoneMatch = String(value).match(/(?:\+?351[\s.-]*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}/)?.[0] || '';
  const before = String(value).replace(phoneMatch, ' ').replace(/\b(nome|contacto|telefone|telem[oó]vel|whatsapp|sou|chamo-me)\b\s*[:=-]?/gi, ' ').replace(/[,;|/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-zÀ-ÿ'’\- ]{2,60}$/u.test(before) || before.split(' ').length > 5) return '';
  return formatName(before);
}

function inferIntentData(intent, message, lead) {
  const text = clean(message, 240);
  const normalized = normalize(text);
  if (intent === 'retoma' && /\b(19|20)\d{2}\b/.test(text) && /\b(km|kms|quilometros?)\b/.test(normalized)) lead.retoma = text;
  if (intent === 'financiamento' && (/€|euro|entrada|meses|prazo|mensalidade|prestacao/.test(normalized))) lead.financiamento = text;
  if (intent === 'visita' && /hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|\bdia\s+\d{1,2}\b|\b\d{1,2}[\/:h]\d{0,2}\b/.test(normalized)) lead.visita = text;
  if (intent === 'disponibilidade') lead.observacoes = lead.observacoes || 'Pedido de confirmação de disponibilidade.';
  return lead;
}

function parseOutput(data = {}) {
  const text = typeof data.output_text === 'string'
    ? data.output_text
    : (data.output || []).flatMap((item) => item.content || []).map((part) => part.text || '').join('\n');
  if (!text.trim()) throw new Error('Resposta vazia.');
  try { return JSON.parse(text); }
  catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta inválida.');
    return JSON.parse(match[0]);
  }
}

function safeReply(question = '', intent = '') {
  const text = normalize(`${intent} ${question}`);
  if (/garantia/.test(text)) return 'Em geral, uma viatura usada vendida por profissional tem garantia legal, mas as condições concretas desta unidade devem ser confirmadas pelo Carlos. A sua pergunta fica registada no pedido.';
  if (/dispon|stock|reserv/.test(text)) return 'A disponibilidade desta unidade será confirmada pelo Carlos. O seu pedido fica preparado sem assumir que a viatura continua disponível.';
  if (/retoma|avali/.test(text)) return 'Os dados da retoma ficam registados para análise. A avaliação e o valor serão indicados apenas pelo Carlos depois de verificar a viatura.';
  if (/financ|prestacao|mensalidade|renda|credito/.test(text)) return 'A preferência de financiamento fica registada. A prestação, aprovação e condições concretas serão confirmadas pelo Carlos e pela entidade financeira.';
  if (/visita|marcar|agendar/.test(text)) return 'O dia e horário pretendidos ficam registados. A visita só fica marcada depois da confirmação do Carlos.';
  return 'A sua questão fica registada para o Carlos confirmar a informação concreta consigo.';
}

function riskyReply(reply = '', question = '') {
  const text = normalize(`${question} ${reply}`);
  return (/\b(disponivel|em stock|reservada|reservado|vendida|vendido)\b/.test(text) && !/confirmar|verificar/.test(text))
    || /\b(prestacao|mensalidade|renda)\s+(fica|sera|é)\b/.test(text)
    || /\b(retoma\s+(vale|fica)|avaliacao\s+(é|fica))\b/.test(text)
    || /\b(visita|reserva|entrega)\s+(confirmada|marcada|agendada|garantida)\b/.test(text);
}

function fallback(message, lead, intent = '') {
  return {
    reply: safeReply(message, intent),
    lead,
    precisa_humano: true,
    interesse_real: true,
    fallback: true
  };
}

function buildPayload({ apiKey, model, intent, vehicle, lead, history, message, retry = false }) {
  const retryInstruction = retry
    ? [{ role: 'user', content: 'A resposta anterior veio vazia ou inválida. Responde agora apenas com o JSON válido exigido pelo esquema.' }]
    : [];
  return {
    model,
    max_output_tokens: retry ? 600 : 480,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Assunto escolhido: ${intent || 'pergunta livre'}` },
      { role: 'user', content: `Viatura em contexto: ${vehicle || 'não selecionada'}` },
      { role: 'user', content: `Dados já recolhidos: ${JSON.stringify(lead)}` },
      ...history,
      { role: 'user', content: message },
      ...retryInstruction
    ],
    text: { format: { type: 'json_schema', name: 'autovalor_response', strict: true, schema: RESPONSE_SCHEMA } }
  };
}

async function requestOpenAI(apiKey, payload) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Falha no serviço de IA.');
  return parseOutput(data);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const body = req.body || {};
  const message = clean(redactForbidden(body.message), 1200);
  if (!message) return res.status(400).json({ error: 'Mensagem vazia.' });

  const intent = ALLOWED_INTENTS.has(body.intent) ? body.intent : '';
  let lead = mergeLead({ viatura: clean(body.contexto?.viatura, 200) }, body.lead || {});
  const phone = extractPhone(message);
  const name = extractName(message, phone);
  if (phone) lead.telefone = phone;
  if (name) lead.nome = name;
  lead = inferIntentData(intent, message, lead);

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return res.status(200).json(fallback(message, lead, intent));

  const history = Array.isArray(body.history) ? body.history.slice(-8).map((entry) => ({
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: clean(redactForbidden(entry.content), 800)
  })) : [];
  const model = process.env.OPENAI_MODEL || 'gpt-5.5';
  const vehicle = clean(body.contexto?.viatura || lead.viatura, 200);

  let parsed;
  try {
    parsed = await requestOpenAI(apiKey, buildPayload({ apiKey, model, intent, vehicle, lead, history, message }));
  } catch (firstError) {
    const retryable = /vazia|inválida|invalid|empty/i.test(String(firstError?.message || ''));
    if (!retryable) {
      console.error('Assistente indisponível', firstError?.message);
      return res.status(200).json(fallback(message, lead, intent));
    }
    try {
      parsed = await requestOpenAI(apiKey, buildPayload({ apiKey, model, intent, vehicle, lead, history: [], message, retry: true }));
    } catch (retryError) {
      console.error('Assistente indisponível após repetição', retryError?.message);
      return res.status(200).json(fallback(message, lead, intent));
    }
  }

  lead = mergeLead(lead, parsed.dados || {});
  if (name && !lead.nome) lead.nome = name;
  if (phone && !lead.telefone) lead.telefone = phone;
  lead = inferIntentData(intent, message, lead);

  let reply = clean(parsed.resposta, 700);
  if (!reply || riskyReply(reply, message)) reply = safeReply(message, intent);

  return res.status(200).json({
    reply,
    lead,
    precisa_humano: Boolean(parsed.precisa_humano) || Boolean(intent) || /Carlos/i.test(reply),
    interesse_real: Boolean(parsed.interesse_real)
  });
}