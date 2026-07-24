const ALLOWED_FIELDS = ['nome', 'telefone', 'viatura', 'financiamento', 'retoma', 'visita', 'observacoes'];
const ALLOWED_INTENTS = new Set(['disponibilidade', 'financiamento', 'retoma', 'visita']);

const EMPTY_LEAD = Object.freeze({
  nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', visita: '', observacoes: ''
});

const SYSTEM_PROMPT = `És o assistente comercial da AutoValorPT e apoias Carlos Vasconcelos na venda de automóveis usados em Portugal.
Responde de forma natural, útil e interventiva, sempre em português de Portugal.

Quando existir um assunto escolhido, interpreta linguagem corrente, abreviaturas e pequenas variações de formato. Não obrigues o cliente a repetir uma resposta que uma pessoa compreenderia facilmente.
- financiamento: precisa de entrada e prazo OU entrada e mensalidade. Exemplo: “3000€ entrada 260€” é completo.
- retoma: precisa de marca, modelo, ano válido e quilometragem. Exemplo: “Fiat Uno 2018 126000” é completo e deve ser normalizado com “km”.
- visita: precisa de dia/data e hora. “Dia 23 às 17” é completo e deve ser normalizado para “Dia 23 às 17h”. “Amanhã 17” pode ser compreendido como “Amanhã às 17h”.
- disponibilidade: regista apenas o pedido de confirmação.

Se os dados estiverem completos, coloca no campo correspondente de dados uma versão curta e normalizada. Se estiverem incompletos, deixa esse campo vazio e explica numa frase o que compreendeste e o único elemento que falta. Faz no máximo uma pergunta de seguimento.
Nunca confirmes disponibilidade, reserva, venda, marcação, valor de retoma, aprovação de crédito, prestação, garantia, equipamento, histórico, estado mecânico, saúde da bateria ou autonomia concreta sem confirmação do Carlos.
Não peças nem guardes NIF, IBAN, documentos, cartões, palavras-passe ou códigos.`;

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
  const match = String(value).match(/(?:(?:\+|00)?351[\s.-]*)?(9\d{2}[\s.-]*\d{3}[\s.-]*\d{3})/);
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
  const phoneMatch = String(value).match(/(?:(?:\+|00)?351[\s.-]*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}/)?.[0] || '';
  let before = String(value).slice(0, String(value).indexOf(phoneMatch));
  before = before
    .replace(/^(?:o\s+)?meu\s+nome\s+(?:é|e)\s*/i, '')
    .replace(/^(?:nome|sou|chamo-me)\s*[:=-]?\s*/i, '')
    .replace(/\b(?:e\s+)?(?:o\s+)?(?:contacto|telefone|telem[oó]vel|whatsapp)\s*(?:é|e|:|=|-)?\s*$/i, '')
    .replace(/[,;|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lastNumber = [...before.matchAll(/\d+/g)].at(-1);
  if (lastNumber) before = before.slice((lastNumber.index || 0) + lastNumber[0].length).trim();
  const words = before.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
  const candidate = words.slice(-6).join(' ');
  if (!candidate || !/^[A-Za-zÀ-ÿ'’\- ]{2,80}$/u.test(candidate)) return '';
  return formatName(candidate);
}

function normalizeVisit(value = '') {
  let output = clean(value, 180);
  output = output.replace(/\b(as|às|pelas?)\s+([01]?\d|2[0-3])\b(?!\s*[:h])/giu, (match, prefix, hour) => {
    const connector = normalize(prefix) === 'as' ? 'às' : prefix.toLocaleLowerCase('pt-PT');
    return `${connector} ${Number(hour)}h`;
  });
  output = output.replace(/^dia\b/i, 'Dia');
  return output;
}

function completeFinancing(value = '') {
  const text = clean(value, 240);
  const normalized = normalize(text);
  const euroValues = [...text.matchAll(/\b\d[\d .]*\s*€/g)].map((match) => match[0]);
  const hasTerm = /\b\d{1,3}\s*(mes|meses|ano|anos)\b/.test(normalized) || /\bprazo\b/.test(normalized);
  const hasMonthly = /\b(mensalidade|prestacao|renda|por\s+mes|mensais?)\b/.test(normalized) || euroValues.length >= 2;
  const hasEntry = /\bentrada\b/.test(normalized)
    || /\bsem entrada\b/.test(normalized)
    || euroValues.length >= 2
    || (euroValues.length >= 1 && hasTerm);
  return Boolean(hasEntry && (hasTerm || hasMonthly));
}

function completeTradeIn(value = '') {
  const text = clean(value, 240);
  const years = [...text.matchAll(/\b(19|20)\d{2}\b/g)];
  const year = years.at(-1)?.[0] || '';
  if (!year) return false;
  const index = text.lastIndexOf(year);
  const withoutYear = `${text.slice(0, index)} ${text.slice(index + year.length)}`;
  const normalized = normalize(withoutYear);
  const labelledMileage = /\b\d{1,6}(?:[ .]\d{3})*\s*(?:mil\s*)?(?:km|kms|quilometros?)\b/.test(normalized);
  const numericValues = [...withoutYear.matchAll(/\b\d[\d .]{2,}\b/g)]
    .map((match) => Number(match[0].replace(/\D/g, '')))
    .filter(Number.isFinite);
  const hasMileage = labelledMileage || numericValues.some((number) => number >= 5000);
  const blocked = new Set(['carro', 'viatura', 'retoma', 'marca', 'modelo', 'ano', 'km', 'kms', 'quilometro', 'quilometros', 'mil']);
  const words = (withoutYear.match(/\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’\-]*\b/gu) || [])
    .filter((word) => !blocked.has(normalize(word)));
  const numericModels = [...withoutYear.matchAll(/\b\d{3,4}\b/g)]
    .map((match) => match[0])
    .filter((number) => Number(number) < 5000);
  return Boolean(hasMileage && words.length + numericModels.length >= 2);
}

function completeVisit(value = '') {
  const text = clean(value, 240);
  const normalized = normalize(text);
  if (/\bdomingo\b/.test(normalized)) return false;
  const hasDay = /\b(hoje|amanha|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/.test(normalized)
    || /\bdia\s+([1-9]|[12]\d|3[01])\b/.test(normalized)
    || /\b([1-9]|[12]\d|3[01])\s+(?:as|pelas?)\b/.test(normalized)
    || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(normalized);
  const hasTime = /\b([01]?\d|2[0-3])(?::[0-5]\d|h(?:[0-5]\d)?)\b/.test(normalized)
    || /\b(?:as|pelas?|por volta (?:das|de))\s+([01]?\d|2[0-3])\b/.test(normalized)
    || /\b(meio[- ]dia|meia[- ]noite)\b/.test(normalized);
  return Boolean(hasDay && hasTime);
}

function intentComplete(intent, value = '') {
  if (intent === 'financiamento') return completeFinancing(value);
  if (intent === 'retoma') return completeTradeIn(value);
  if (intent === 'visita') return completeVisit(value);
  return true;
}

function intentField(intent = '') {
  if (intent === 'financiamento') return 'financiamento';
  if (intent === 'retoma') return 'retoma';
  if (intent === 'visita') return 'visita';
  return '';
}

function inferIntentData(intent, message, lead) {
  const text = clean(message, 240);
  if (intent === 'retoma' && completeTradeIn(text)) lead.retoma = text;
  if (intent === 'financiamento' && completeFinancing(text)) lead.financiamento = text;
  if (intent === 'visita' && completeVisit(text)) lead.visita = normalizeVisit(text);
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

function missingIntentReply(message = '', intent = '') {
  const text = normalize(message);
  if (intent === 'financiamento') {
    if (/entrada|sem entrada|€|euro/.test(text)) return 'Percebi a indicação sobre a entrada. Falta dizer o prazo pretendido ou a mensalidade aproximada.';
    if (/mes|prazo|mensal|prestacao|renda/.test(text)) return 'Percebi o prazo ou a mensalidade. Falta indicar a entrada pretendida, mesmo que seja sem entrada.';
    return 'Para preparar o financiamento, indique a entrada e o prazo ou a mensalidade aproximada.';
  }
  if (intent === 'retoma') {
    const hasYear = /\b(19|20)\d{2}\b/.test(text);
    const hasMileage = /\bkm|kms|quilomet/.test(text) || /\b\d{4,6}\b/.test(text);
    if (hasYear && !hasMileage) return 'Percebi a viatura e o ano. Falta apenas indicar os quilómetros.';
    if (!hasYear && hasMileage) return 'Percebi a quilometragem. Falta indicar a marca, o modelo e o ano.';
    return 'Para preparar a retoma, indique marca, modelo, ano e quilómetros.';
  }
  if (intent === 'visita') {
    const hasDay = /hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|\bdia\s+\d{1,2}\b|\b\d{1,2}[\/-]\d{1,2}\b/.test(text);
    const hasTime = /\b\d{1,2}(?:[:h]\d{0,2})\b|\b(?:as|pelas?)\s+\d{1,2}\b|meio-dia/.test(text);
    if (hasDay && !hasTime) return 'Percebi o dia pretendido. Falta apenas indicar a hora.';
    if (!hasDay && hasTime) return 'Percebi o horário. Falta apenas indicar o dia pretendido.';
    return 'Indique o dia e a hora preferidos para a visita.';
  }
  return '';
}

function safeReply(question = '', intent = '') {
  const missing = missingIntentReply(question, intent);
  if (missing) return missing;
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

function buildPayload({ model, intent, vehicle, lead, history, message, retry = false }) {
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
    parsed = await requestOpenAI(apiKey, buildPayload({ model, intent, vehicle, lead, history, message }));
  } catch (firstError) {
    const retryable = /vazia|inválida|invalid|empty/i.test(String(firstError?.message || ''));
    if (!retryable) {
      console.error('Assistente indisponível', firstError?.message);
      return res.status(200).json(fallback(message, lead, intent));
    }
    try {
      parsed = await requestOpenAI(apiKey, buildPayload({ model, intent, vehicle, lead, history: [], message, retry: true }));
    } catch (retryError) {
      console.error('Assistente indisponível após repetição', retryError?.message);
      return res.status(200).json(fallback(message, lead, intent));
    }
  }

  const parsedLead = sanitizeLead(parsed.dados || {});
  const selectedField = intentField(intent);
  if (selectedField && parsedLead[selectedField] && !intentComplete(intent, parsedLead[selectedField])) {
    parsedLead[selectedField] = '';
  }
  if (selectedField === 'visita' && parsedLead.visita) parsedLead.visita = normalizeVisit(parsedLead.visita);

  lead = mergeLead(lead, parsedLead);
  if (name && !lead.nome) lead.nome = name;
  if (phone && !lead.telefone) lead.telefone = phone;
  lead = inferIntentData(intent, message, lead);

  let reply = clean(parsed.resposta, 700);
  if (!reply || riskyReply(reply, message)) reply = safeReply(message, intent);
  if (selectedField && !lead[selectedField]) reply = reply || missingIntentReply(message, intent);

  return res.status(200).json({
    reply,
    lead,
    precisa_humano: Boolean(parsed.precisa_humano) || Boolean(intent) || /Carlos/i.test(reply),
    interesse_real: Boolean(parsed.interesse_real)
  });
}