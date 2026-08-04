export const FOLLOWUP_STAGES = Object.freeze([
  Object.freeze({ stage: 1, offsetHours: 24, template: 'lead_followup_1' }),
  Object.freeze({ stage: 2, offsetHours: 72, template: 'lead_followup_2' }),
  Object.freeze({ stage: 3, offsetHours: 168, template: 'lead_followup_3' })
]);

const CLOSED_STATUSES = new Set(['closed', 'won', 'lost', 'sold', 'not_interested', 'do_not_contact']);
const REPLIED_STATUSES = new Set(['replied', 'responded']);
const NEGOTIATION_STATUSES = new Set(['negotiation', 'negotiating']);

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localWeekday(date, timeZone = 'Europe/Lisbon') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short'
  }).format(date);
}

export function isSunday(date, timeZone = 'Europe/Lisbon') {
  const parsed = asDate(date);
  if (!parsed) return false;
  return localWeekday(parsed, timeZone) === 'Sun';
}

export function getSentStages(lead = {}) {
  const values = Array.isArray(lead.followupsSent) ? lead.followupsSent : [];
  return new Set(
    values
      .map((entry) => Number(typeof entry === 'object' ? entry?.stage : entry))
      .filter((stage) => Number.isInteger(stage) && stage > 0)
  );
}

export function getNextStage(lead = {}) {
  const sent = getSentStages(lead);
  return FOLLOWUP_STAGES.find((item) => !sent.has(item.stage)) || null;
}

export function evaluateFollowUp(lead = {}, now = new Date(), options = {}) {
  const timeZone = options.timeZone || 'Europe/Lisbon';
  const current = asDate(now) || new Date();
  const status = String(lead.status || 'open').toLowerCase();

  if (lead.optedOut === true || lead.doNotContact === true) {
    return { eligible: false, reason: 'do_not_contact' };
  }

  if (CLOSED_STATUSES.has(status)) {
    return { eligible: false, reason: 'closed_status' };
  }

  if (REPLIED_STATUSES.has(status)) {
    return { eligible: false, reason: 'customer_replied' };
  }

  if (NEGOTIATION_STATUSES.has(status)) {
    return { eligible: false, reason: 'in_negotiation' };
  }

  if (String(lead.vehicleStatus || '').toLowerCase() === 'sold') {
    return { eligible: false, reason: 'vehicle_sold' };
  }

  if (lead.canContact === false) {
    return { eligible: false, reason: 'contact_not_allowed' };
  }

  const sequenceStartedAt = asDate(lead.sequenceStartedAt);
  if (!sequenceStartedAt) {
    return { eligible: false, reason: 'missing_sequence_start' };
  }

  const lastInboundAt = asDate(lead.lastInboundAt);
  if (lastInboundAt && lastInboundAt.getTime() > sequenceStartedAt.getTime()) {
    return { eligible: false, reason: 'customer_replied' };
  }

  const nextStage = getNextStage(lead);
  if (!nextStage) {
    return { eligible: false, reason: 'sequence_complete' };
  }

  const dueAt = new Date(sequenceStartedAt.getTime() + nextStage.offsetHours * 60 * 60 * 1000);
  if (current.getTime() < dueAt.getTime()) {
    return {
      eligible: false,
      reason: 'not_due',
      stage: nextStage.stage,
      template: nextStage.template,
      dueAt: dueAt.toISOString()
    };
  }

  if (isSunday(current, timeZone)) {
    return {
      eligible: false,
      reason: 'sunday_pause',
      stage: nextStage.stage,
      template: nextStage.template,
      dueAt: dueAt.toISOString()
    };
  }

  return {
    eligible: true,
    reason: 'due',
    stage: nextStage.stage,
    template: nextStage.template,
    dueAt: dueAt.toISOString()
  };
}

export function buildFollowUpVariables(lead = {}) {
  return {
    nome: String(lead.name || '').trim(),
    viatura: String(lead.vehicle || '').trim()
  };
}
