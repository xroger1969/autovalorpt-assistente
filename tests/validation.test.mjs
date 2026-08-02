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
  ['912345678 Carlos', 'Carlos', '912345678', '912345678'],
  ['O meu número é 912 345 678, chamo-me Rita', 'Rita', '912345678', '912345678'],
  ['912 345 678 nome Ana Rita', 'Ana Rita', '912345678', '912345678'],
  ['Maria 92344556', '', '', '92344556'],
  ['Maria +351 92344556', '', '', '92344556'],
  ['Maria 223445556', '', '', '223445556'],
  ['923445556', '', '923445556', '923445556']
];

test('extrai nome e contacto em ordens naturais sem confundir dados da viatura', () => {
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
  ['mensalidade 350€', false],
  ['3000€ de entrada mas não sei o prazo', false],
  ['3000€ entrada, prazo ainda por decidir', false],
  ['não sei a entrada, queria 84 meses', false],
  ['3000€ entrada e não sei a mensalidade nem o prazo', false]
];

test('valida financiamento e não transforma respostas negativas em dados fornecidos', () => {
  for (const [input, expected] of financingCases) {
    assert.equal(validateFinancing(input).ok, expected, input);
  }
  assert.equal(validateFinancing('3000€ entrada mas não sei o prazo').hardReject, true);
  assert.match(validateFinancing('3000€ entrada mas não sei o prazo').retry, /prazo/i);
});

const tradeInCases = [
  ['Renault Clio 2019 85000 km', true],
  ['Renault Clio 2019 85000', true],
  ['BMW X1 2021 45.000 kms', true],
  ['Peugeot 2008, 2020, 90 mil km', true],
  ['Peugeot 2008 GT 2020 90 000 km', true],
  ['Peugeot 2008 GT 90 000 km', false],
  ['Peugeot 3008, 2020, 85 000 km', true],
  ['Peugeot 5008 2021 72.000 km', true],
  ['Renault Clio 2019', false],
  ['Renault 2019 85000km', false],
  ['Carro 2019 85000 km', false],
  ['Peugeot 2008 2020', false],
  ['Renault Clio 2019 km', false]
];

test('distingue números de modelo de anos e exige marca, modelo, ano e quilometragem', () => {
  for (const [input, expected] of tradeInCases) {
    assert.equal(validateTradeIn(input).ok, expected, input);
  }
  assert.equal(validateTradeIn('Fiat Uno ano 3015 50000km').hardReject, true);
});

test('rejeita quilometragens absurdas ou contraditórias', () => {
  const absurd = validateTradeIn('Fiat Bravo 2019 1 230 000 km');
  assert.equal(absurd.ok, false);
  assert.equal(absurd.hardReject, true);
  assert.match(absurd.retry, /1[.\s]?230[.\s]?000|1 230 000/);

  const contradictory = validateTradeIn('Fiat Bravo 1 230 000 km, 2019, 124 000 km');
  assert.equal(contradictory.ok, false);
  assert.equal(contradictory.hardReject, true);

  const twoPlausible = validateTradeIn('Fiat Bravo 2019, 84 000 km ou 124 000 km');
  assert.equal(twoPlausible.ok, false);
  assert.equal(twoPlausible.hardReject, true);
  assert.match(twoPlausible.retry, /mais do que uma quilometragem/i);
});

const visitCases = [
  ['dia 28 às 17h', true],
  ['Dia 23 às 17', true],
  ['terça-feira 12h', true],
  ['28 às 17h', true],
  ['23 pelas 9', true],
  ['sexta às 17', true],
  ['amanhã às 9:30', true],
  ['amanhã 17', true],
  ['28/07 10h', true],
  ['sábado meio-dia', true],
  ['dia 28', false],
  ['às 17h', false],
  ['sexta de manhã', false],
  ['domingo 10h', false],
  ['dia 23 às 25', false]
];

test('compreende horários naturais e rejeita erros objetivos', () => {
  for (const [input, expected] of visitCases) {
    assert.equal(validateVisit(input).ok, expected, input);
  }
  assert.equal(validateVisit('Dia 23 às 17').normalized, 'Dia 23 às 17h');
  assert.equal(validateVisit('amanhã 17').normalized, 'amanhã às 17h');
  assert.match(validateVisit('domingo 10h').retry, /domingo/i);
  assert.equal(validateVisit('domingo 10h').hardReject, true);
  assert.equal(validateVisit('dia 23 às 25').hardReject, true);
});

test('calcula o dia da semana de datas concretas e rejeita domingos', () => {
  const sunday = validateVisit('09/08/2026 às 17h');
  assert.equal(sunday.ok, false);
  assert.equal(sunday.hardReject, true);
  assert.match(sunday.retry, /domingo/i);

  const saturday = validateVisit('08/08/2026 às 17h');
  assert.equal(saturday.ok, true);

  const invalidDate = validateVisit('31/02/2027 às 17h');
  assert.equal(invalidDate.ok, false);
  assert.equal(invalidDate.hardReject, true);
  assert.match(invalidDate.retry, /data/i);
});
