import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleTerm, estimatedPayment, fullSimulatorUrl, QUICK_TERMS, referenceAmount,
  type CreditLimits,
} from '../src/quick-finance.ts';

const limits: CreditLimits = {
  minAmount: 5000, maxAmount: 75000, amountStep: 500,
  minMonths: 24, maxMonths: 120, monthStep: 6,
};

test('compact slider only uses requested terms', () => {
  assert.deepEqual(QUICK_TERMS, [60, 72, 84, 120]);
  for (const months of QUICK_TERMS) assert.equal(eligibleTerm(months, limits), true);
  assert.equal(eligibleTerm(72, { ...limits, maxMonths: 60 }), false);
  assert.equal(eligibleTerm(84, { ...limits, monthStep: 12 }), true);
  assert.equal(eligibleTerm(72, { ...limits, monthStep: 7 }), false);
});

test('financing never silently changes advertised vehicle price', () => {
  assert.deepEqual(referenceAmount(13000, limits), { amount: 13000, approximate: false });
  assert.deepEqual(referenceAmount(12990, limits), { amount: 13000, approximate: true });
  assert.equal(estimatedPayment(12990, { amount: 13000, approximate: true }, 150), 149.88);
  assert.equal(referenceAmount(2000, limits), null);
  assert.equal(referenceAmount(Number.NaN, limits), null);
  assert.equal(referenceAmount(75001, limits), null);
  assert.equal(referenceAmount(12990, { ...limits, amountStep: 10000 }), null);
  assert.equal(estimatedPayment(12990, { amount: 13000, approximate: true }, -1), null);
});

test('open full credit simulator with selected PVP, zero entry, term and car year', () => {
  const url = new URL(fullSimulatorUrl(12990, 84, 2020));
  assert.equal(url.origin, 'https://xroger1969.github.io');
  assert.equal(url.pathname, '/CREDICARROS/');
  assert.equal(url.searchParams.get('pvp'), '12990');
  assert.equal(url.searchParams.get('entrada'), '0');
  assert.equal(url.searchParams.get('prazo'), '84');
  assert.equal(url.searchParams.get('ano'), '2020');
  assert.equal(url.searchParams.get('tipo'), 'used');
});
