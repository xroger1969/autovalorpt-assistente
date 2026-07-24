import test from 'node:test';
import assert from 'node:assert/strict';
import '../validation-core.js';

const {
  extractFlexibleContact,
  validateFinancing,
  validateTradeIn,
  validateVisit
} = globalThis.AutoValorValidation;

const contactCases = [
  ['Carlos 923445556', 'Carlos', '923445556', '923445556'],
  ['Carlos +351 923 445 556', 'Carlos', '923445556', '923445556'],
  ['Carlos 00351 923445556', 'Carlos', '923445556', '923445556'],
  ['Fiat Uno 2015, Carlos 923 445 556', 'Carlos', '923445556', '923445556'],
  ['O meu nome é Ana Rita e o contacto é 913 222 111', 'Ana Rita', '913222111', '913222111'],
  ['João Pedro Manuel da Silva 923445556', 'João Pedro Manuel da Silva', '923445556', '923445556'],
  ['Renault Clio 2019 85000 km João Silva 912345678', 'João Silva', '912345678', '912345678'],
  ['Maria 92344556', '', '', '92344556'],
  ['Maria +351 92344556', '', '', '92344556'],
  ['Maria 223445556', '', '', '223445556'],
  ['923445556', '', '923445556', '923445556']
];

test('extrai nome e contacto sem confundir dados da viatura', () => {
  for (const [input, nome, telefone, candidateDigits] of contactCases) {
    assert.deepEqual(extractFlexibleContact(input), { nome, telefone, candidateDigits }, input);
  }
});

const financingCases = [
  ['3000€ de entrada e 84 meses', true],
  ['2000€ entrada e 350€', true],
  ['1000€ 24 meses', true],
  ['300€ por mês sem entrada', true],
  ['350€ 84 meses', true],
  ['sem entrada 60 meses', true],
  ['quero financiamento', false],
  ['84 meses', false],
  ['3000€ entrada', false],
  ['mensalidade 350€', false]
];

test('valida financiamento com entrada e prazo ou mensalidade', () => {
  for (const [input, expected] of financingCases) {
    assert.equal(validateFinancing(input).ok, expected, input);
  }
});

const tradeInCases = [
  ['Renault Clio 2019 85000 km', true],
  ['Renault Clio 2019 85000', true],
  ['BMW X1 2021 45.000 kms', true],
  ['Peugeot 2008, 2020, 90 mil km', true],
  ['Renault Clio 2019', false],
  ['Renault 2019 85000km', false],
  ['Carro 2019 85000 km', false],
  ['Fiat Uno 3015 50000km', false],
  ['Peugeot 2008 2020', false],
  ['Renault Clio 2019 km', false]
];

test('exige marca, modelo, ano válido e quilometragem na retoma', () => {
  for (const [input, expected] of tradeInCases) {
    assert.equal(validateTradeIn(input).ok, expected, input);
  }
  assert.equal(validateTradeIn('Fiat Uno 3015 50000km').hardReject, true);
});

const visitCases = [
  ['dia 28 às 17h', true],
  ['Dia 23 às 17', true],
  ['terça-feira 12h', true],
  ['28 às 17h', true],
  ['23 pelas 9', true],
  ['sexta às 17', true],
  ['amanhã às 9:30', true],
  ['28/07 10h', true],
  ['sábado meio-dia', true],
  ['dia 28', false],
  ['às 17h', false],
  ['amanhã 17', false],
  ['sexta de manhã', false],
  ['domingo 10h', false],
  ['dia 23 às 25', false]
];

test('compreende formatos naturais, exige dia e hora e rejeita erros objetivos', () => {
  for (const [input, expected] of visitCases) {
    assert.equal(validateVisit(input).ok, expected, input);
  }
  assert.equal(validateVisit('Dia 23 às 17').normalized, 'Dia 23 às 17h');
  assert.equal(validateVisit('amanhã 17').plausible, true);
  assert.equal(validateVisit('amanhã 17').hardReject, false);
  assert.match(validateVisit('domingo 10h').retry, /domingo/i);
  assert.equal(validateVisit('domingo 10h').hardReject, true);
  assert.equal(validateVisit('dia 23 às 25').hardReject, true);
});