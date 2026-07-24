import '../validation-core.js';

const V = globalThis.AutoValorValidation;

const cases = {
  contacto: [
    ['Carlos 923445556', { nome: 'Carlos', telefone: '923445556', candidateDigits: '923445556' }],
    ['Carlos +351 923 445 556', { nome: 'Carlos', telefone: '923445556', candidateDigits: '923445556' }],
    ['O meu nome é Ana Rita e o contacto é 913 222 111', { nome: 'Ana Rita', telefone: '913222111', candidateDigits: '913222111' }],
    ['Fiat Uno 2015, Carlos 923 445 556', { nome: 'Carlos', telefone: '923445556', candidateDigits: '923445556' }],
    ['Maria +351 92344556', { nome: '', telefone: '', candidateDigits: '92344556' }],
    ['Maria 223445556', { nome: '', telefone: '', candidateDigits: '223445556' }]
  ],
  financiamento: [
    ['3000€ de entrada e 84 meses', true], ['1000€ 24 meses', true],
    ['300€ por mês sem entrada', true], ['quero financiamento', false],
    ['3000€ entrada', false], ['mensalidade 350€', false]
  ],
  retoma: [
    ['Renault Clio 2019 85000 km', true], ['BMW X1 2021 45.000 kms', true],
    ['Peugeot 2008, 2020, 90 mil km', true], ['Renault 2019 85000km', false],
    ['Carro 2019 85000 km', false], ['Fiat Uno 3015 50000km', false]
  ],
  visita: [
    ['dia 28 às 17h', true], ['28 às 17h', true], ['terça-feira 12h', true],
    ['dia 28', false], ['às 17h', false], ['domingo 10h', false]
  ]
};

export default function handler(req, res) {
  const failures = [];
  let total = 0;

  for (const [input, expected] of cases.contacto) {
    total += 1;
    const actual = V.extractFlexibleContact(input);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push({ group: 'contacto', input, expected, actual });
  }
  for (const [group, validator] of [
    ['financiamento', V.validateFinancing],
    ['retoma', V.validateTradeIn],
    ['visita', V.validateVisit]
  ]) {
    for (const [input, expected] of cases[group]) {
      total += 1;
      const actual = validator(input).ok;
      if (actual !== expected) failures.push({ group, input, expected, actual });
    }
  }

  res.status(failures.length ? 500 : 200).json({ ok: failures.length === 0, total, passed: total - failures.length, failures });
}