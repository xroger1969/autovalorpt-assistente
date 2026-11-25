import { readInventory } from './meta-catalog-source.js';

const COMMISSION = {
  label: 'Comissão Europeia',
  url: 'https://employment-social-affairs.ec.europa.eu/policies-and-activities/funding/social-climate-fund/social-climate-fund-national-plans_en',
};
const AGENCY = {
  label: 'Agência para o Clima',
  url: 'https://apclima.pt/apoios-e-fundos/fundos-e-programas/fundo-social-para-o-clima/',
};
const FUND = { label: 'Fundo Ambiental', url: 'https://www.fundoambiental.pt/' };
const PROPOSAL = {
  label: 'Governo de Portugal', date: '2026-10-09',
  url: 'https://portugal.gov.pt/gc25/comunicacao/comunicados/portugal-entrega-a-bruxelas-plano-social-para-o-clima-de-16-mil-milhoes-de-euros',
};
const CHECK_NOTICE = 'As candidaturas abrem por aviso próprio. Procura o aviso em vigor para confirmar os prazos e a elegibilidade da tua viatura. Para outros apoios à compra de elétricos, consulta o Fundo Ambiental.';

function portuguesePlanStatus(html) {
  // Match the full country entry. An adopted neighbouring plan must never
  // change the Portuguese assessment, even after a page layout change.
  const entries = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi)]
    .map(([, markup]) => markup.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(text => /^Portugal(?:\s|$)/.test(text));
  if (entries.length !== 1) return null;
  if (entries[0] === 'Portugal submitted (Commission assessment phase)') return 'submitted';
  if (entries[0] === 'Portugal adopted') return 'adopted';
  return null;
}

export async function readElectricGrantUpdate({ date, fetchImpl = fetch }) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('editorial_date_invalid');
  if (date < PROPOSAL.date || date >= '2028-01-01') return { text: CHECK_NOTICE, sources: [AGENCY, FUND] };

  const checked = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon' }).format(new Date());
  // A future preview can cite today's check. An archived edition must never
  // acquire a later Commission decision under its original publication date.
  if (date >= checked) {
    try {
      const response = await fetchImpl(COMMISSION.url, { headers: { Accept: 'text/html' }, redirect: 'error',
        credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(2700) });
      if (!response.url || response.url === COMMISSION.url) {
        const status = portuguesePlanStatus(await readInventory(response, 300_000));
        if (status) {
          const stage = status === 'adopted' ? 'a Comissão Europeia já indicava como aprovado o Plano Social para o Clima de Portugal' : 'o Plano Social para o Clima de Portugal estava em avaliação pela Comissão Europeia';
          const day = checked.split('-').reverse().join('/');
          return { text: `Apoios de 2027 · Em ${day}, ${stage}. ${CHECK_NOTICE}`, sources: [{ ...COMMISSION, date: checked }, AGENCY, FUND] };
        }
      }
    } catch { /* An unverified result cannot establish current eligibility. */ }
  }
  return { text: `Em 9 de outubro de 2026, Portugal apresentou a proposta de Plano Social para o Clima, que previa apoios à mobilidade elétrica de famílias vulneráveis e microempresas. ${CHECK_NOTICE}`, sources: [PROPOSAL, AGENCY, FUND] };
}
