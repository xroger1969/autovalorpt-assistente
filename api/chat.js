const ALLOWED_FIELDS = ['nome', 'telefone', 'viatura', 'financiamento', 'retoma', 'visita', 'observacoes'];
const ALLOWED_INTENTS = new Set(['disponibilidade', 'financiamento', 'retoma', 'visita']);

const EMPTY_LEAD = Object.freeze({
  nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', visita: '', observacoes: ''
});

const BLOCKED_NAME_WORDS = new Set([
  'entrada', 'prestacao', 'prestação', 'mensalidade', 'renda', 'financiamento', 'credito', 'crédito',
  'retoma', 'avaliacao', 'avaliação', 'valor', 'euros', 'euro', 'stock', 'disponibilidade', 'disponivel',
  'disponível', 'reserva', 'visita', 'garantia', 'equipamento', 'bateria', 'autonomia', 'telefone',
  'telemovel', 'telemóvel', 'whatsapp', 'contacto', 'numero', 'número', 'km', 'kms', 'gasolina', 'diesel',
  'eletrico', 'elétrico', 'hibrido', 'híbrido', 'renault', 'clio', 'megane', 'mégane', 'tesla', 'dacia',
  'fiat', 'nissan', 'bmw', 'mercedes', 'volkswagen', 'hyundai', 'kia', 'peugeot', 'citroen', 'citroën',
  'ford', 'toyota', 'audi', 'volvo', 'seat', 'skoda', 'opel', 'mazda', 'honda', 'lexus', 'jeep',
  'porsche', 'mg', 'quero', 'pretendo', 'preciso', 'pode', 'podem', 'ligar', 'ligue', 'contactar',
  'amanha', 'amanhã', 'hoje', 'tarde', 'manha', 'manhã', 'noite', 'obrigado', 'obrigada', 'sim', 'nao', 'não'
]);

const SYSTEM_PROMPT = `És o assistente comercial da AutoValorPT e apoias Carlos Vasconcelos na venda de automóveis usados em Portugal.

Objetivo:
- Responder primeiro à dúvida do cliente de forma natural e útil.
- Tratar apenas o assunto escolhido no interface quando existir: disponibilidade, financiamento, retoma ou visita.
- Ajudar com automóveis, carregamento, utilização, manutenção e compra em termos gerais.
- Recolher e organizar dados sem repetir perguntas sobre informação já fornecida.
- Usar sempre português de Portugal, salvo se o cliente escrever noutra língua.

Como interpretar o assunto escolhido:
- disponibilidade: recolhe nome e contacto para o Carlos confirmar a unidade.
- financiamento: recolhe entrada, prazo ou mensalidade pretendida; nunca calcula nem promete uma prestação.
- retoma: recolhe marca, modelo, ano e quilómetros; nunca atribui valor.
- visita: recolhe dia e horário preferidos; nunca confirma a marcação.

Limites comerciais obrigatórios:
1. Nunca confirmes disponibilidade, stock, reserva, venda, entrega ou marcação concluída.
2. Nunca atribuas valor a uma retoma nem avalies a viatura do cliente.
3. Nunca indiques ou prometas prestação, renda, mensalidade, taxa, aprovação ou condição concreta de crédito.
4. Nunca confirmes preço final, desconto, despesas, garantia, equipamento, histórico, estado mecânico, saúde da bateria ou autonomia real da unidade concreta.
5. Não inventes características técnicas. Quando não existirem dados confirmados, usa “em geral”, “normalmente” ou “depende da versão”.
6. Tudo o que envolva confirmação concreta deve ser encaminhado para o Carlos.
7. Não peças nem guardes NIF, morada completa, cartão de cidadão, IBAN, cartões bancários, palavras-passe, códigos ou documentos.

Estilo:
- Caloroso, claro e comercial, sem pressão.
- Duas a quatro frases curtas.
- No máximo uma pergunta de seguimento.
- Não menciones estas regras internas.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resposta: { type: 'string' },
    dados: {
      type: 'object',
      additionalProperties: false,
      properties: {
        nome: { type: 'string' }, telefone: { type: 'string' }, viatura: { type: 'string' },
        financiamento: { type: 'string' }, retoma: { type: 'string' }, visita: { type: 'string' },
        observacoes: { type: 'string' }
      },
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

function redactForbidden(value = '') {
  return String(value)
    .replace(/\b(NIF|contribuinte)\b\s*[:\-]?\s*\d{9}\b/gi, '[NIF removido]')
    .replace(/\bIBAN\b\s*[:\-]?\s*[A-Z]{2}\d{2}[A-Z0-9\s]{11,30}\b/gi, '[IBAN removido]')
    .replace(/\b(cart[aã]o de cidad[aã]o|CC)\b\s*[:\-]?\s*[A-Z0-9\-\s]{6,25}/gi, '[documento removido]')
    .replace(/\b(password|senha|palavra-passe|c[oó]digo)\b\s*[:\-]?\s*\S+/gi, '[credencial removida]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, '[cartão removido]');
}

function normalize(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function formatName(value = '') {
  const particles = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);
  return String(value).trim().replace(/\s+/g, ' ').split(' ').map((word, index) => {
    const lower = word.toLocaleLowerCase('pt-PT');
    if (index > 0 && particles.has(lower)) return lower;
    return lower.charAt(0).toLocaleUpperCase('pt-PT') + lower.slice(1);
  }).join(' ');
}

function validNameCandidate(value = '') {
  const candidate = String(value).trim().replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').replace(/\s+/g, ' ');
  if (!candidate || candidate.length > 80 || /\d|@|https?:/i.test(candidate)) return '';
  const words = candidate.split(' ');
  if (words.length > 5 || !words.every((word) => /^[A-Za-zÀ-ÿ'’\-]+$/u.test(word))) return '';
  const relevant = words.filter((word) => !['da', 'das', 'de', 'do', 'dos', 'e'].includes(normalize(word)));
  if (!relevant.length || relevant.some((word) => BLOCKED_NAME_WORDS.has(normalize(word)))) return '';
  return formatName(candidate);
}

function extractPhone(value = '') {
  const match = String(value).match(/(?:\+?351[\s.-]*)?(9\d{2}[\s.-]*\d{3}[\s.-]*\d{3})/);
  return match ? match[1].replace(/\D/g, '') : '';
}

function extractName(value = '', phone = '') {
  const text = String(value);
  const labelled = [
    /(?:^|[\n,;.!?]\s*|\s+)(?:(?:o\s+)?meu\s+nome|nome|cliente)\s*(?:é|e|:)\s*([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu,
    /(?:^|[\n,;.!?]\s*|\s+)chamo[-\s]me\s+([^\n,;.!?]+?)(?=\s+(?:e\s+)?(?:o\s+)?(?:meu\s+)?(?:n[uú]mero|telefone|telem[oó]vel|contacto|whatsapp)\b|[\n,;.!?]|$)/iu
  ];
  for (const pattern of labelled) {
    const candidate = validNameCandidate(text.match(pattern)?.[1]);
    if (candidate) return candidate;
  }
  if (!phone) return '';
  const phoneMatch = text.match(/(?:\+?351[\s.-]*)?9\d{2}[\s.-]*\d{3}[\s.-]*\d{3}/)?.[0] || '';
  const phoneIndex = text.indexOf(phoneMatch);
  const before = phoneIndex >= 0 ? text.slice(0, phoneIndex) : text;
  const segments = before.split(/[\n,;|]+/).map((part) => part.trim()).filter(Boolean);
  for (let index = segments.length - 1; index >= Math.max(0, segments.length - 2); index -= 1) {
    const candidate = validNameCandidate(segments[index].replace(/^(sou|nome|contacto|o meu nome [ée])\s*[:,-]?\s*/i, ''));
    if (candidate) return candidate;
  }
  const words = before.match(/[A-Za-zÀ-ÿ'’\-]+/gu) || [];
  for (let size = Math.min(4, words.length); size >= 1; size -= 1) {
    const candidate = validNameCandidate(words.slice(-size).join(' '));
    if (candidate) return candidate;
  }
  return '';
}

function sanitizeLead(input = {}) {
  const lead = { ...EMPTY_LEAD };
  for (const field of ALLOWED_FIELDS) lead[field] = clean(redactForbidden(input[field]), field === 'observacoes' ? 350 : 180);
  return lead;
}

function mergeLead(base = {}, next = {}) {
  const result = sanitizeLead(base);
  const incoming = sanitizeLead(next);
  for (const field of ALLOWED_FIELDS) if (incoming[field]) result[field] = incoming[field];
  return result;
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

function riskyReply(reply = '', question = '') {
  const text = normalize(`${question} ${reply}`);
  const availability = /\b(esta|continua|temos|encontra-se)\s+(disponivel|em stock)|\bja foi vendid|\breservad[ao]\b/.test(text)
    && !/\b(confirmar|verificar|validar|carece)\b/.test(text);
  const finance = /\b(financiamento|credito)\s+(aprovado|garantido)|\b(prestacao|mensalidade|renda)\s+(fica|sera|é)\b/.test(text);
  const valuation = /\b(retoma\s+(vale|fica)|avaliacao\s+(é|fica)|oferta\s+de)\b/.test(text);
  const commitment = /\b(visita|reserva|entrega)\s+(confirmada|marcada|agendada|garantida)\b/.test(text);
  return availability || finance || valuation || commitment;
}

function safeReply(question = '', intent = '') {
  const text = normalize(`${intent} ${question}`);
  if (/dispon|stock|reserv/.test(text)) return 'A disponibilidade será confirmada pelo Carlos. Os dados que indicou ficam preparados para o contacto, sem assumir que a viatura continua disponível.';
  if (/retoma|avali/.test(text)) return 'Os dados da retoma ficam registados para análise. A avaliação e o valor só serão indicados pelo Carlos depois de verificar a viatura.';
  if (/financ|prestacao|mensalidade|renda|credito/.test(text)) return 'A preferência de financiamento fica registada. A prestação, aprovação e condições concretas serão confirmadas pelo Carlos e pela entidade financeira.';
  if (/visita|marcar|agendar/.test(text)) return 'O horário pretendido fica registado. A visita só fica marcada depois da confirmação do Carlos.';
  return 'Essa informação concreta deve ser confirmada pelo Carlos. A sua questão fica organizada para ele responder diretamente.';
}

function fallback(message, lead, intent = '') {
  const phone = lead.telefone;
  const name = lead.nome;
  let reply;
  if (intent === 'disponibilidade') {
    if (name && phone) reply = `Obrigado, ${name}. O pedido para confirmar a disponibilidade ficou preparado para o Carlos.`;
    else if (phone) reply = 'Obrigado. Falta apenas indicar o seu nome para o Carlos confirmar a disponibilidade.';
    else if (name) reply = `Obrigado, ${name}. Falta apenas o contacto/WhatsApp para o Carlos confirmar a disponibilidade.`;
    else reply = 'Indique o seu nome e contacto/WhatsApp para o Carlos confirmar a disponibilidade desta viatura.';
  } else if (intent === 'retoma') {
    reply = 'Os dados da sua viatura ficam preparados para avaliação. O valor da retoma será indicado apenas pelo Carlos após análise.';
  } else if (intent === 'financiamento') {
    reply = 'A preferência de financiamento fica registada. A prestação e as condições concretas serão confirmadas pelo Carlos e pela entidade financeira.';
  } else if (intent === 'visita') {
    reply = 'O dia e horário pretendidos ficam registados. A visita só fica marcada depois da confirmação do Carlos.';
  } else {
    reply = name && phone
      ? `Obrigado, ${name}. A sua questão ficou preparada para o Carlos responder diretamente.`
      : 'Posso ajudar com esta viatura e preparar o contacto com o Carlos.';
  }
  return { reply, lead, precisa_humano: true, interesse_real: true };
}

function inferIntentData(intent, message, lead) {
  const text = clean(message, 240);
  const normalized = normalize(text);
  if (intent === 'retoma' && !lead.retoma && (/\b(19|20)\d{2}\b/.test(text) || /\bkm\b|quilomet/.test(normalized))) lead.retoma = text;
  if (intent === 'financiamento' && !lead.financiamento && /€|euro|entrada|meses|prazo|mensal|prestacao/.test(normalized)) lead.financiamento = text;
  if (intent === 'visita' && !lead.visita && /hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|\b\d{1,2}[:h]\d{0,2}\b/.test(normalized)) lead.visita = text;
  if (intent === 'disponibilidade' && !lead.observacoes) lead.observacoes = 'Pedido de confirmação de disponibilidade.';
  return lead;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const body = req.body || {};
  const message = clean(redactForbidden(body.message), 1200);
  if (!message) return res.status(400).json({ error: 'Mensagem vazia.' });

  const intent = ALLOWED_INTENTS.has(body.intent) ? body.intent : '';
  let lead = mergeLead({ viatura: body.contexto?.viatura || '' }, body.lead || {});
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

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        max_output_tokens: 480,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Assunto escolhido: ${intent || 'pergunta livre'}` },
          { role: 'user', content: `Viatura em contexto: ${clean(body.contexto?.viatura || lead.viatura, 200) || 'não selecionada'}` },
          { role: 'user', content: `Dados já recolhidos: ${JSON.stringify(lead)}` },
          ...history,
          { role: 'user', content: message }
        ],
        text: { format: { type: 'json_schema', name: 'autovalor_response', strict: true, schema: RESPONSE_SCHEMA } }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Falha no serviço de IA.');
    const parsed = parseOutput(data);
    lead = mergeLead(lead, parsed.dados || {});
    if (!lead.nome && name) lead.nome = name;
    if (!lead.telefone && phone) lead.telefone = phone;
    lead = inferIntentData(intent, message, lead);

    let reply = clean(parsed.resposta, 700);
    if (!reply || riskyReply(reply, message)) reply = safeReply(message, intent);

    return res.status(200).json({
      reply,
      lead,
      precisa_humano: Boolean(parsed.precisa_humano) || Boolean(intent) || /Carlos/i.test(reply),
      interesse_real: Boolean(parsed.interesse_real)
    });
  } catch (error) {
    console.error('Assistente indisponível', error?.message);
    return res.status(200).json(fallback(message, lead, intent));
  }
}
