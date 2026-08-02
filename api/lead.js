const ALLOWED_FIELDS = ['nome', 'telefone', 'viatura', 'financiamento', 'retoma', 'visita', 'observacoes'];

function clean(value = '', max = 500) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeLead(input = {}) {
  const lead = {};
  for (const field of ALLOWED_FIELDS) {
    lead[field] = clean(input?.[field], field === 'observacoes' ? 500 : 220);
  }
  return lead;
}

function safeUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function formatMessage({ lead, vehicleUrl, intents = [] }) {
  const labels = {
    disponibilidade: 'Disponibilidade',
    financiamento: 'Financiamento',
    retoma: 'Retoma',
    visita: 'Visita'
  };

  const lines = [
    '🚗 *NOVO LEAD — AutoValorPT*',
    '',
    `👤 *Nome:* ${lead.nome || 'Não indicado'}`,
    `📱 *Contacto:* ${lead.telefone || 'Não indicado'}`,
    `🚘 *Viatura:* ${lead.viatura || 'Não indicada'}`
  ];

  if (vehicleUrl) lines.push(`🔗 *Anúncio:* ${vehicleUrl}`);
  if (intents.length) lines.push(`🎯 *Interesse:* ${intents.map((intent) => labels[intent] || clean(intent, 40)).join(', ')}`);
  if (lead.financiamento) lines.push(`💳 *Financiamento:* ${lead.financiamento}`);
  if (lead.retoma) lines.push(`🔄 *Retoma:* ${lead.retoma}`);
  if (lead.visita) lines.push(`📅 *Visita:* ${lead.visita}`);
  if (lead.observacoes) lines.push(`📝 *Observações:* ${lead.observacoes}`);
  lines.push('', '✅ Pedido recolhido pelo Assistente AI CV.');
  return lines.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const webhook = String(process.env.SLACK_WEBHOOK_URL || '').trim();
  if (!webhook) return res.status(503).json({ error: 'Slack não configurado.' });

  const lead = sanitizeLead(req.body?.lead || {});
  if (!lead.nome || !lead.telefone || !lead.viatura) {
    return res.status(400).json({ error: 'Lead incompleto.' });
  }

  const intents = Array.isArray(req.body?.intents)
    ? req.body.intents.map((value) => clean(value, 40)).filter(Boolean).slice(0, 6)
    : [];
  const vehicleUrl = safeUrl(req.body?.vehicleUrl);

  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatMessage({ lead, vehicleUrl, intents }) })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Slack webhook falhou', response.status, detail.slice(0, 200));
      return res.status(502).json({ error: 'Falha ao enviar para Slack.' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Erro ao enviar lead para Slack', error?.message || error);
    return res.status(502).json({ error: 'Falha ao enviar para Slack.' });
  }
}
