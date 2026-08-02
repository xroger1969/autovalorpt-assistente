import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContactOrder, validateStructuredMessage } from '../api/chat-smart.js';

test('normaliza contactos com o telefone antes ou no meio do nome', () => {
  assert.equal(normalizeContactOrder('912345678 Carlos'), 'Carlos 912345678');
  assert.equal(normalizeContactOrder('O meu número é 912 345 678, chamo-me Rita'), 'Rita 912345678');
});

test('a API aplica as mesmas proteções do validador do browser', () => {
  const negativeFinance = validateStructuredMessage('3000€ entrada mas não sei o prazo', 'financiamento');
  assert.equal(negativeFinance.ok, false);
  assert.match(negativeFinance.retry, /prazo/i);

  const model3008 = validateStructuredMessage('Peugeot 3008 2020 85 000 km', 'retoma');
  assert.equal(model3008.ok, true);

  const contradictoryMileage = validateStructuredMessage('Fiat Bravo 1 230 000 km, 2019, 124 000 km', 'retoma');
  assert.equal(contradictoryMileage.ok, false);
  assert.equal(contradictoryMileage.hardReject, true);

  const sunday = validateStructuredMessage('09/08/2026 às 17h', 'visita');
  assert.equal(sunday.ok, false);
  assert.match(sunday.retry, /domingo/i);

  const tomorrow = validateStructuredMessage('amanhã 17', 'visita');
  assert.equal(tomorrow.ok, true);
  assert.equal(tomorrow.normalized, 'amanhã às 17h');
});
