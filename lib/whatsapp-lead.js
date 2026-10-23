// Completes the five-parameter template prepared in PR #24. Credentials and the
// approved template are configured privately; no recipient is read from a lead.
const DEFAULT_LANGUAGE = 'pt_PT';
const DEFAULT_TIMEOUT_MS = 8000;
const PRIVATE_INBOX = 'https://autovalorpt-assistente.vercel.app/leads.html';

function clean(value = '', max = 500) {
  return String(value || '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function recipient(value = '') {
  const source = String(value).trim();
  if (!/^\+?[\d\s().-]+$/.test(source)) return '';
  const digits = source.replace(/\D/g, '').replace(/^00/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
}

export function getWhatsAppConfig(env = process.env) {
  const accessToken = String(env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const to = recipient(env.WHATSAPP_ALERT_TO || '');
  const templateName = String(env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const graphVersion = String(env.WHATSAPP_GRAPH_VERSION || '').trim();
  const language = String(env.WHATSAPP_TEMPLATE_LANGUAGE || DEFAULT_LANGUAGE).trim();
  const missing = [];
  if (!accessToken || /\s/.test(accessToken) || accessToken.length > 4096) missing.push('WHATSAPP_ACCESS_TOKEN');
  // A Graph object ID is not a telephone number; it may exceed E.164's 15 digits.
  if (!/^[1-9]\d{7,19}$/.test(phoneNumberId)) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!to) missing.push('WHATSAPP_ALERT_TO');
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) missing.push('WHATSAPP_TEMPLATE_NAME');
  if (!/^v[1-9]\d{0,2}\.\d{1,2}$/.test(graphVersion)) missing.push('WHATSAPP_GRAPH_VERSION');
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) missing.push('WHATSAPP_TEMPLATE_LANGUAGE');
  return {
    enabled: env.WHATSAPP_ENABLED === 'true', configured: missing.length === 0, missing,
    accessToken, phoneNumberId, to, templateName, graphVersion, language
  };
}

function leadDetails(lead = {}) {
  const parts = [];
  for (const [key, label, max] of [
    ['financing', 'Financiamento', 220], ['tradeIn', 'Retoma', 220],
    ['registration', 'Matrícula', 40], ['visit', 'Visita', 160], ['observations', 'Obs.', 500]
  ]) {
    const value = clean(lead[key], max);
    if (value) parts.push(`${label}: ${value}`);
  }
  const count = Number(lead.photos?.count || 0);
  const photoCount = Number.isSafeInteger(count) && count >= 0 && count <= 10 ? count : 0;
  const link = /^[a-f0-9]{32}$/.test(String(lead.id || '')) ? `${PRIVATE_INBOX}?lead=${lead.id}` : PRIVATE_INBOX;
  // Keep both the attachment count and authenticated link even when notes are
  // long. The link carries an opaque ID and never embeds customer details.
  const suffix = `Fotografias: ${photoCount} · Pedido: ${link}`;
  const details = parts.join(' · ') || 'Sem detalhes adicionais';
  const available = Math.max(0, 1024 - suffix.length - 3);
  return `${details.slice(0, available).trimEnd()} · ${suffix}`;
}

export function buildWhatsAppTemplatePayload(lead = {}, config = {}) {
  return {
    messaging_product: 'whatsapp', to: recipient(config.to), type: 'template',
    template: {
      name: String(config.templateName || '').trim(),
      language: { code: String(config.language || DEFAULT_LANGUAGE).trim() },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: clean(lead.name || 'Não indicado', 120) },
          { type: 'text', text: clean(lead.phone || 'Não indicado', 40) },
          { type: 'text', text: clean(lead.vehicle || 'Ainda sem viatura escolhida', 220) },
          { type: 'text', text: clean(lead.subjects || 'Pedido de informação', 220) },
          { type: 'text', text: leadDetails(lead) }
        ]
      }]
    }
  };
}

export async function sendWhatsAppLead(lead = {}, options = {}) {
  const config = getWhatsAppConfig(options.env || process.env);
  if (!config.enabled) return { status: 'disabled', error: 'whatsapp_disabled' };
  if (!config.configured) return { status: 'unconfigured', error: 'whatsapp_not_configured', missing: config.missing };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { status: 'failed', error: 'whatsapp_transport_unavailable', retryable: true };

  const configuredTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(30_000, configuredTimeout) : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 'unknown', error: 'whatsapp_timeout' });
    }, timeoutMs);
  });

  async function send() {
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify(buildWhatsAppTemplatePayload(lead, config))
      });
      const httpStatus = Number(response.status);
      if (httpStatus >= 400 && httpStatus < 500) {
        return { status: 'failed', error: 'whatsapp_rejected', httpStatus, retryable: httpStatus === 429 };
      }
      if (!response.ok || httpStatus < 200 || httpStatus >= 300) {
        return { status: 'unknown', error: 'whatsapp_delivery_unconfirmed', ...(httpStatus ? { httpStatus } : {}) };
      }
      const data = await response.json().catch(() => ({}));
      const id = data?.messages?.[0]?.id;
      if (typeof id !== 'string' || !id.startsWith('wamid.') || id.length <= 6 || id.length > 1024 || /\s/.test(id)) {
        return { status: 'unknown', error: 'whatsapp_delivery_unconfirmed', httpStatus };
      }
      return { status: 'accepted', providerId: id, httpStatus };
    } catch {
      // The provider may have accepted a request before a network failure. The
      // coordinator must retain this uncertainty instead of resending blindly.
      return { status: 'unknown', error: 'whatsapp_delivery_unconfirmed' };
    }
  }

  try { return await Promise.race([send(), timeout]); }
  finally { clearTimeout(timer); }
}
