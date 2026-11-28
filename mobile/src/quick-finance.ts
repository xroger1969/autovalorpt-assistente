/** Prestações apresentadas apenas a partir de uma cotação pública recente.
 * A fonte CREDICARROS aceita montantes discretos. Não apresentar um valor
 * ajustado como cotação exata para o PVP da viatura.
 */
export const QUICK_TERMS = [60, 72, 84, 120] as const;
export type QuickTerm = (typeof QUICK_TERMS)[number];

export interface CreditLimits {
  minAmount: number;
  maxAmount: number;
  amountStep: number;
  minMonths: number;
  maxMonths: number;
  monthStep: number;
}
export interface ReferenceAmount {
  amount: number;
  approximate: boolean;
}

export function eligibleTerm(months: number, limits: CreditLimits): boolean {
  return Number.isInteger(months) && Number.isInteger(limits.monthStep) &&
    limits.monthStep > 0 && months >= limits.minMonths && months <= limits.maxMonths &&
    (months - limits.minMonths) % limits.monthStep === 0;
}

/** Never silently replace the advertised PVP by a different financed amount. */
export function referenceAmount(price: number, limits: CreditLimits): ReferenceAmount | null {
  if (!Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(limits.minAmount) || !Number.isFinite(limits.maxAmount) ||
      !Number.isFinite(limits.amountStep) || limits.amountStep <= 0 ||
      price < limits.minAmount || price > limits.maxAmount) return null;
  const first = Math.ceil(limits.minAmount / limits.amountStep) * limits.amountStep;
  const last = Math.floor(limits.maxAmount / limits.amountStep) * limits.amountStep;
  if (first > last) return null;
  const amount = Math.max(first, Math.min(last, Math.round(price / limits.amountStep) * limits.amountStep));
  const difference = Math.abs(price - amount);
  // Only derive an approximation from a genuinely nearby permitted amount.
  if (difference > Math.min(500, price * 0.05)) return null;
  return { amount, approximate: difference > 0.005 };
}

export function estimatedPayment(price: number, reference: ReferenceAmount, payment: number): number | null {
  if (!Number.isFinite(payment) || payment <= 0 || !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(reference.amount) || reference.amount <= 0) return null;
  // Only an approximation: taxes and fixed credit charges do not scale linearly.
  const result = Math.round(payment * (price / reference.amount) * 100) / 100;
  return result > 0 && Number.isFinite(result) ? result : null;
}

export function fullSimulatorUrl(price: number, term: QuickTerm, year: number | null): string {
  const cleanPrice = Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : 0;
  const cleanYear = year !== null && Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear()
    ? `&ano=${year}` : '';
  return `https://xroger1969.github.io/CREDICARROS/?pvp=${cleanPrice}&entrada=0&prazo=${term}&tipo=used${cleanYear}&utm_source=autovalorpt-app`;
}
