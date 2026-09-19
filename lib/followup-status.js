const STATUS_MAP = Object.freeze({
  waiting: 'open',
  replied: 'replied',
  negotiation: 'negotiation',
  closed: 'closed',
  do_not_contact: 'do_not_contact'
});

function asIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data de estado inválida.');
  return date.toISOString();
}

export function normalizeFollowUpState(value = '') {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.prototype.hasOwnProperty.call(STATUS_MAP, key) ? key : '';
}

export function applyFollowUpState(lead = {}, requestedState = '', now = new Date()) {
  const state = normalizeFollowUpState(requestedState);
  if (!state) throw new Error('Estado de follow-up inválido.');

  const timestamp = asIso(now);
  const next = {
    ...lead,
    status: STATUS_MAP[state],
    updatedAt: timestamp
  };

  if (state === 'waiting') {
    next.status = 'open';
    next.sequenceStartedAt = timestamp;
    next.lastInboundAt = null;
    next.followupsSent = [];
    next.canContact = true;
    next.optedOut = false;
    next.doNotContact = false;
  }

  if (state === 'replied') {
    next.lastInboundAt = timestamp;
  }

  if (state === 'negotiation') {
    next.lastInboundAt = next.lastInboundAt || timestamp;
  }

  if (state === 'closed') {
    next.closedAt = timestamp;
  }

  if (state === 'do_not_contact') {
    next.canContact = false;
    next.optedOut = true;
    next.doNotContact = true;
    next.closedAt = timestamp;
  }

  return next;
}

export function followUpStateLabel(value = '') {
  const state = normalizeFollowUpState(value);
  return ({
    waiting: 'Aguardar',
    replied: 'Respondeu',
    negotiation: 'Negociação',
    closed: 'Fechado',
    do_not_contact: 'Não contactar'
  })[state] || '';
}

export const FOLLOWUP_UI_STATES = Object.freeze([
  Object.freeze({ value: 'waiting', label: 'Aguardar' }),
  Object.freeze({ value: 'replied', label: 'Respondeu' }),
  Object.freeze({ value: 'negotiation', label: 'Negociação' }),
  Object.freeze({ value: 'closed', label: 'Fechado' }),
  Object.freeze({ value: 'do_not_contact', label: 'Não contactar' })
]);
