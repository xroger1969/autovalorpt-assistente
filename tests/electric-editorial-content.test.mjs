import test from 'node:test';
import assert from 'node:assert/strict';
import { ELECTRIC_TIPS } from '../lib/electric-editorial-content.js';

test('electric tips have distinct stable IDs, complete factual copy and three short choices per card', () => {
  assert.ok(ELECTRIC_TIPS.length >= 16);
  for (const key of ['id', 'title', 'body']) {
    assert.equal(new Set(ELECTRIC_TIPS.map(tip => tip[key])).size, ELECTRIC_TIPS.length);
  }
  for (const { id, title, body, options, cta, alternative } of ELECTRIC_TIPS) {
    assert.match(id, /^eletrico-[a-z0-9-]+$/);
    assert.ok(title.endsWith('?') && title.length <= 55, id);
    assert.ok(body.length > 30 && body.length <= 175, id);
    assert.ok(cta.length > 10 && cta.length <= 95, id);
    assert.ok(alternative.title.endsWith('?') && alternative.title.length <= 75, id);
    assert.ok(alternative.cta.endsWith('?') && alternative.cta.length <= 110, id);
    assert.notEqual(alternative.title, title);
    assert.notEqual(alternative.cta, cta);
    assert.equal(options.length, 3);
    assert.equal(new Set(options).size, 3);
    assert.ok(options.every(option => option.length > 1 && option.length <= 24), id);
  }
});

test('the first six buying questions direct both captions to the owner’s simulator and distinguish energy costs', () => {
  const nearTerm = ELECTRIC_TIPS.slice(0, 6);
  assert.deepEqual(nearTerm.map(tip => tip.id), [
    'eletrico-custo-cem-km', 'eletrico-poupanca-anual', 'eletrico-casa-posto-custo',
    'eletrico-usado-orcamento', 'eletrico-custo-trajeto', 'eletrico-plug-in-custos',
  ]);
  for (const tip of nearTerm) {
    assert.match(tip.cta, /comparador AutoValorPT/);
    assert.match(tip.alternative.cta, /comparador AutoValorPT/);
  }
  assert.match(nearTerm[0].body, /15 kWh.*0,20 €.*3 €.*6 litros.*1,80 €.*10,80 €/);
  assert.match(nearTerm[1].body, /Se .*4 €.*12 000 km.*480 €/);
  assert.match(nearTerm[1].body, /multiplica 4 € por 120/);
  assert.match(nearTerm[3].body, /800 km por mês, multiplica por oito/);
  assert.match(nearTerm[5].body, /600 km elétricos e 400 km a combustível.*por 100 km.*seis vezes o custo elétrico e quatro vezes o custo a combustível/);
  for (const i of [1, 3, 5]) {
    assert.match(nearTerm[i].alternative.cta, /por 100 km/);
    assert.doesNotMatch(nearTerm[i].cta + nearTerm[i].alternative.cta, /quilómetros anuais|diferença mensal|percentagem elétrica/i);
  }
  assert.match(nearTerm[4].body, /Se .*4 €.*40 km.*1,60 €/);
});
