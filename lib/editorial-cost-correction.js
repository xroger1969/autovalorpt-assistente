import { SIMULATOR_URL } from './electric-editorial-calendar.js';

// The approved JPEG and its caption are a single, dated manual edition.
export const costCorrectionImage = '/assets/editorial/custo-100km-20261126-r2.jpg';
export const costCorrection = {
  id: 'extra-2026-11-27-custo-100km-r2',
  date: '2026-11-27',
  version: 'custo-100km-r2',
  extra: true,
  format: 'IMAGE',
  title: 'Quanto custa percorrer 100 km?',
  topic: 'Custo por 100 km',
  topicId: 'custo-100km-corrigido',
  copyOrigin: 'editorial',
  simulatorUrl: SIMULATOR_URL,
  caption: [
    'Quanto custa percorrer 100 km? Com um elétrico que consome 13 kWh na tomada e uma tarifa de casa de 0,14 €/kWh, a energia fica em 1,82 €.',
    'Se o carro consumir 6 L/100 km, a mesma distância custa 11,11 € a gasolina 95 simples (1,851 €/L) ou 12,21 € a gasóleo simples (2,035 €/L).',
    'Usámos os preços médios dos combustíveis em Portugal continental de 26/11/2026, segundo a DGEG. Os 0,14 €/kWh são uma tarifa doméstica de exemplo.',
    'Quanto te custam os teus 100 km? Introduz o teu consumo e a tua tarifa no simulador do perfil @autovalorpt.',
    SIMULATOR_URL,
    '#AutoValorPT #Almada #MobilidadeElétrica',
  ].join('\n\n'),
  slides: [{ altText: 'Custo de energia por 100 km. Elétrico em casa, 1,82 € a 0,14 €/kWh e 13 kWh/100 km. A 6 L/100 km, gasolina 95 simples, 11,11 €, e gasóleo simples, 12,21 €. Médias DGEG de 26/11/2026 em Portugal continental.' }],
};
