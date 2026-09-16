const DEFAULT_LANGUAGE = 'pt_PT';

function clean(value = '', max = 500) {
  return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function digits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

export function getWhatsAppConfig(env = process.env) {
  const accessToken = String(env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const to = digits(env.WHATSAPP_ALERT_TO || '');
  const templateName = String(env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const graphVersion = String(env.WHATSAPP_GRAPH_VERSION || '').trim();
  const language = String(env.WHATSAPP_TEMPLATE_LANGUAGE || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE;

  const missing = [];
  if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!to) missing.push('WHATSAPP_ALERT_TO');
  if (!templateName) missing.push('WHATSAPP_TEMPLATE_NAME');
  if (!/^v\d+\.\d+$/.test(graphVersion)) missing.push('WHATSAPP_GRAPH_VERSION');

  return {
    configured: missing.length === 0,
    missing,
    accessToken,
    phoneNumberId,
    to,
    templateName,
    graphVersion,
    language
  };
}

function leadDetails(lead = {}) {
  const details = [];
  if (lead.financing) details.push(`Financiamento: ${clean(lead.financing, 220)}`);
  if (lead.tradeIn) details.push(`Retoma: ${clean(lead.tradeIn, 220)}`);
  if (lead.registration) details.push(`Matrícula: ${clean(lead.registration, 40)}`);
  if (lead.visit) details.push(`Visita: ${clean(lead.visit, 160)}`);
  if (lead.observations) details.push(`Obs.: ${clean(lead.observations, 220)}`);
  return details.join(' · ') || 'Sem detalhes adicionais';
}

export function buildWhatsAppTemplatePayload(lead = {}, config = {}) {
  return {
    messaging_product: 'whatsapp',
    to: digits(config.to),
    type: 'template',
    template: {
      name: String(config.templateName || '').trim(),
      language: { code: String(config.language || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: clean(lead.name || 'Não indicado', 120) },
            { type: 'text', text: clean(lead.phone || 'Não indicado', 40) },
            { type: 'text', text: clean(lead.vehicle || 'Não indicada', 220) },
            { type: 'text', text: clean(lead.subjects || 'Pedido AutoValorPT', 220) },
            { type: 'text', text: leadDetails(lead).slice(0, 900) }
          ]
        }
      ]
    }
  };
}

export async function sendWhatsAppLead(lead = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const config = getWhatsAppConfig(env);

  if (!config.configured) {
    console.info('whatsapp_notify_lead_skipped', { missing: config.missing });
    return { ok: false, skipped: true, error: 'whatsapp_not_configured', missing: config.missing };
  }

  if (typeof fetchImpl !== 'function') {
    console.error('whatsapp_notify_lead_error', 'fetch_unavailable');
    return { ok: false, error: 'whatsapp_unreachable' };
  }

  const endpoint = `https://graph.facebook.com/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  const payload = buildWhatsAppTemplatePayload(lead, config);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = data?.error?.code || null;
      const type = data?.error?.type || null;
      const message = clean(data?.error?.message || 'unknown', 220);
      console.error('whatsapp_notify_lead_failed', response.status, { code, type, message });
      return { ok: false, error: 'whatsapp_failed', status: response.status, code };
    }

    return {
      ok: true,
      id: data?.messages?.[0]?.id || null
    };
  } catch (error) {
    console.error('whatsapp_notify_lead_error', clean(error?.message || error, 220));
    return { ok: false, error: 'whatsapp_unreachable' };
  }
}
