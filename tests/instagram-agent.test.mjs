import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptSourceCaption } from '../lib/instagram-agent.js';

test('adapta a legenda da Ranger ao padrão AutoValorPT', () => {
  const source = `🐎 FORD RANGER RAPTOR 🐎\n➡️2023 NACIONAL\n➡️GASOLINA\n➡️3.0 cc de 292 cv\n➡️62.990€**\n➡️78.000 km\n➡️Possível valor mensal\n➡️Aceitamos retomas\n\n👀www.samucar.pt👀\nTratamos do processo de financiamento.`;
  const result = adaptSourceCaption(source);
  assert.match(result, /FORD RANGER RAPTOR/);
  assert.match(result, /2023 NACIONAL/);
  assert.match(result, /292 cv/i);
  assert.match(result, /78\.000 km/i);
  assert.match(result, /62\.990€/);
  assert.match(result, /AutoValorPT/);
  assert.doesNotMatch(result, /samucar\.pt/i);
});
