import { CHANNELS } from './lead-registry.js';
import { getWhatsAppConfig, sendWhatsAppLead } from './whatsapp-lead.js';
import { privateLeadOrigin, privateLeadUrl } from './lead-links.js';
export { privateLeadUrl } from './lead-links.js';

const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';
const EXTERNAL_ID = 'autovalorpt-carlos';
const DELIVERY_STATUSES = new Set(['pending', 'sending', 'accepted', 'failed', 'unknown', 'unconfigured', 'disabled']);

export function outboundEnabled(env = process.env) {
  if (env.NOTIFICATIONS_ENABLED === 'false') return false;
  return env.VERCEL_ENV === 'production' ||
    (env.VERCEL_ENV === 'preview' && env.NOTIFICATIONS_PREVIEW_ENABLED === 'true' && Boolean(privateLeadOrigin(env)));
}

export function notificationConfiguration(env = process.env) {
  const whatsapp = getWhatsAppConfig(env);
  return {
    onesignal: { configured: Boolean(String(env.ONESIGNAL_AUTOVALORPT_API_KEY || env.ONESIGNAL_API_KEY || '').trim()) },
    slack: { configured: Boolean(String(env.SLACK_WEBHOOK_URL || '').trim()) },
    whatsapp: { configured: whatsapp.configured, enabled: whatsapp.enabled, missing: [...whatsapp.missing] },
    outboundEnabled: outboundEnabled(env)
  };
}

export function notificationIdempotencyKey(leadId = '') {
  if (!/^[a-f0-9]{32}$/.test(String(leadId))) throw new Error('invalid_lead_id');
  return `${leadId.slice(0, 8)}-${leadId.slice(8, 12)}-4${leadId.slice(13, 16)}-a${leadId.slice(17, 20)}-${leadId.slice(20)}`;
}

export function buildPushPayload(lead, env = process.env) {
  return {
    app_id: APP_ID,
    target_channel: 'push',
    include_aliases: { external_id: [EXTERNAL_ID] },
    headings: { en: 'Novo pedido — Assistente do Carlos' },
    contents: { en: 'Recebeu um novo pedido. Abra a área privada para consultar os detalhes.' },
    data: { leadId: lead.id },
    url: privateLeadUrl(lead, env),
    idempotency_key: notificationIdempotencyKey(lead.id)
  };
}

function slackEscape(value = '') {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function buildSlackMessage(lead = {}, env = process.env) {
  const entries = [
    ['Nome', lead.name], ['Contacto', lead.phone],
    ['Viatura', lead.vehicle || 'Pedido geral — ainda sem viatura escolhida'],
    ['Anúncio', lead.vehicleUrl], ['Assuntos', lead.subjects], ['Visita', lead.visit],
    ['Financiamento', lead.financing], ['Retoma', lead.tradeIn], ['Matrícula', lead.registration],
    ['Observações', lead.observations]
  ];
  const lines = ['NOVO PEDIDO — Assistente do Carlos'];
  for (const [label, value] of entries) if (value) lines.push(`${label}: ${slackEscape(value)}`);
  if (lead.photos?.count) lines.push(`Fotografias da retoma: ${Number(lead.photos.count)} (na área privada)`);
  lines.push(`Área privada: ${privateLeadUrl(lead, env)}`);
  return { text: lines.join('\n'), mrkdwn: false, unfurl_links: false, unfurl_media: false, link_names: false };
}

async function withDeadline(operation, timeoutMs = 8000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('provider_timeout'), { name: 'TimeoutError' }));
    }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}

export async function sendOneSignalLead(lead, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const key = String(env.ONESIGNAL_AUTOVALORPT_API_KEY || env.ONESIGNAL_API_KEY || '').trim();
  if (!key) return { status: 'unconfigured', error: 'onesignal_not_configured' };
  try {
    return await withDeadline(async (signal) => {
      const response = await fetchImpl('https://api.onesignal.com/notifications', {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
        body: JSON.stringify(buildPushPayload(lead, env)), signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return {
        status: 'failed', error: 'onesignal_rejected', httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429
      };
      if (typeof data.id !== 'string' || !data.id.trim()) {
        return { status: 'failed', error: 'onesignal_no_message_id', httpStatus: response.status, retryable: true };
      }
      return { status: 'accepted', providerId: data.id.slice(0, 200), httpStatus: response.status };
    }, timeoutMs);
  } catch {
    // Stable provider idempotency makes an identical OneSignal retry safe.
    return { status: 'failed', error: 'onesignal_not_confirmed', retryable: true };
  }
}

export async function sendSlackLead(lead, { env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const webhook = String(env.SLACK_WEBHOOK_URL || '').trim();
  if (!webhook) return { status: 'unconfigured', error: 'slack_not_configured' };
  try {
    const parsed = new URL(webhook);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return { status: 'unconfigured', error: 'slack_invalid_configuration' };
    return await withDeadline(async (signal) => {
      const response = await fetchImpl(webhook, {
        method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSlackMessage(lead, env)), signal
      });
      const body = await response.text();
      if (response.ok && body.trim() === 'ok') return { status: 'accepted', httpStatus: response.status };
      if (response.status >= 400 && response.status < 500) return {
        status: 'failed', error: 'slack_rejected', httpStatus: response.status, retryable: response.status === 429
      };
      return { status: 'unknown', error: 'slack_not_confirmed', httpStatus: response.status };
    }, timeoutMs);
  } catch {
    // Slack webhooks have no idempotency key. A lost response needs review.
    return { status: 'unknown', error: 'slack_not_confirmed' };
  }
}

export function publicNotificationStatuses(states = {}) {
  return Object.fromEntries(CHANNELS.map((channel) => [channel, {
    status: DELIVERY_STATUSES.has(states[channel]?.status) ? states[channel].status : 'pending'
  }]));
}

function safeResult(value, channel) {
  if (!DELIVERY_STATUSES.has(value?.status) || ['pending', 'sending'].includes(value.status)) {
    return { status: channel === 'onesignal' ? 'failed' : 'unknown', error: 'provider_not_confirmed', retryable: channel === 'onesignal' };
  }
  const result = { status: value.status };
  if (typeof value.providerId === 'string') result.providerId = value.providerId.slice(0, 200);
  if (typeof value.error === 'string' && /^[a-z0-9_]{1,80}$/.test(value.error)) result.error = value.error;
  if (Number.isInteger(value.httpStatus)) result.httpStatus = value.httpStatus;
  if (typeof value.retryable === 'boolean') result.retryable = value.retryable;
  return result;
}

export function createNotificationService({ repository, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000, senders = {} }) {
  const providers = {
    onesignal: senders.onesignal || sendOneSignalLead,
    slack: senders.slack || sendSlackLead,
    whatsapp: senders.whatsapp || sendWhatsAppLead
  };

  async function notify(record, { allowUnknown = false, manual = false } = {}) {
    // Manual retries can revisit entries removed after a disabled/unknown result.
    // Recreate the durable recovery marker before any external call.
    const recoveryClaim = await repository.ensureRecovery(record);
    const outcomes = await Promise.allSettled(CHANNELS.map(async (channel) => {
      const claim = await repository.claimDelivery(record.id, channel, { allowUnknown, manual });
      if (!claim) return null;
      let result;
      if (!outboundEnabled(env)) result = { status: 'disabled', error: 'outbound_disabled' };
      else {
        try { result = safeResult(await providers[channel](record, { env, fetchImpl, timeoutMs }), channel); }
        catch { result = { status: channel === 'onesignal' ? 'failed' : 'unknown', error: 'provider_not_confirmed', retryable: channel === 'onesignal' }; }
      }
      return repository.finishDelivery(claim, result);
    }));
    const states = await repository.notifications(record.id);
    // A failed state write leaves its lease/outbox intact for controlled recovery.
    if (outcomes.every((outcome) => outcome.status === 'fulfilled')) await repository.settleOutbox(record, states, recoveryClaim);
    return states;
  }

  return { notify, configuration: () => notificationConfiguration(env) };
}
