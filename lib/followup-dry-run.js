import { buildFollowUpVariables, evaluateFollowUp } from './followup-policy.js';
import { listFollowUpLeads } from './followup-registry.js';

const FOLLOWUP_MESSAGES = Object.freeze({
  1: ({ nome, viatura }) => `Bom dia${nome ? `, ${nome}` : ''} 👋 Carlos por aqui. Estou a dar seguimento ao seu pedido${viatura ? ` sobre o ${viatura}` : ''}. Continua interessado? Se precisar de alguma informação, simulação ou ajuda com retoma, diga-me e trato disso consigo.`,
  2: ({ nome, viatura }) => `Olá${nome ? `, ${nome}` : ''}. Só queria confirmar se ainda está a considerar${viatura ? ` o ${viatura}` : ' a viatura'}. Se quiser, posso também analisar consigo as possibilidades de financiamento ou retoma. Estou disponível 👍`,
  3: ({ nome, viatura }) => `Olá${nome ? `, ${nome}` : ''}. Faço apenas um último contacto${viatura ? ` relativamente ao ${viatura}` : ''}, para não estar a incomodar. Se continuar interessado, responda-me aqui e retomamos o processo. Obrigado 👍`
});

export function maskPhone(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export function buildFollowUpMessage(stage, lead = {}) {
  const builder = FOLLOWUP_MESSAGES[Number(stage)];
  if (!builder) return '';
  return builder(buildFollowUpVariables(lead));
}

export function scanFollowUps(leads = [], now = new Date(), options = {}) {
  const due = [];
  const blocked = {};
  const timeZone = options.timeZone || 'Europe/Lisbon';

  for (const lead of Array.isArray(leads) ? leads : []) {
    const evaluation = evaluateFollowUp(lead, now, { timeZone });
    if (!evaluation.eligible) {
      const reason = evaluation.reason || 'unknown';
      blocked[reason] = (blocked[reason] || 0) + 1;
      continue;
    }

    due.push({
      leadId: String(lead.id || ''),
      name: String(lead.name || ''),
      phoneMasked: maskPhone(lead.phone),
      vehicle: String(lead.vehicle || ''),
      stage: evaluation.stage,
      template: evaluation.template,
      dueAt: evaluation.dueAt,
      message: buildFollowUpMessage(evaluation.stage, lead)
    });
  }

  return {
    mode: 'dry-run',
    sendEnabled: false,
    evaluatedAt: new Date(now).toISOString(),
    total: Array.isArray(leads) ? leads.length : 0,
    dueCount: due.length,
    due,
    blocked
  };
}

export async function runFollowUpDryRun(now = new Date(), options = {}) {
  const leads = await listFollowUpLeads({ limit: options.limit || 200 });
  return scanFollowUps(leads, now, options);
}
