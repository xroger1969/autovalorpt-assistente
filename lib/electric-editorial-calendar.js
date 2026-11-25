import { editorialPlan } from './editorial-content.js';
import { ELECTRIC_TIPS } from './electric-editorial-content.js';

export const ELECTRIC_IMAGE_VERSION = 'v2';
export const SIMULATOR_URL = 'https://carregador.vercel.app/';
const CREDIT_SIMULATOR_URL = 'https://credicarros.vercel.app/simulador-ano.html';
const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 26);
const signature = 'AutoValorPT · Almada\n#AutoValorPT #MobilidadeElétrica #CarrosElétricos';
export function simulatorCaption(post) {
  const energy = 'Abre o comparador de elétrico e combustão nos links do perfil @autovalorpt.\n' + SIMULATOR_URL;
  return post.creditSimulatorUrl ? energy + '\n\nSe ponderas financiar a compra, estima também a prestação.\n' + CREDIT_SIMULATOR_URL : energy;
}

const grants = [
  { id: 'apoios-eletricos-aviso', title: 'Apoio à compra de um elétrico em 2027?',
    body: 'Antes de contares com um incentivo, procura o aviso oficial. Confirma a quem se destina, quais as viaturas abrangidas e o prazo.',
    options: ['Quem se pode candidatar', 'Viaturas abrangidas', 'Prazo do aviso'],
    cta: 'Que condição gostarias de esclarecer primeiro?',
    alternative: { title: 'Vais fazer as contas com um incentivo?', cta: 'Já encontraste o aviso que se aplica à tua compra?' } },
  { id: 'apoios-eletricos-usado', title: 'Um elétrico usado pode ter apoio?',
    body: 'O aviso de cada programa define as condições. Confirma se admite usados e se estabelece regras para a data da compra ou para o vendedor.',
    options: ['Estado do veículo', 'Data da compra', 'Tipo de vendedor'],
    cta: 'Que pergunta levarias ao stand sobre o apoio?',
    alternative: { title: 'Viste um usado e ouviste falar de um apoio?', cta: 'Que condição precisas de confirmar antes de decidir?' } },
];
const news = [
  { id: 'eletricos-atualidade-dados', title: 'Um elétrico faz quantos quilómetros?',
    body: 'Ao ler uma notícia sobre autonomia, procura a versão do carro, as condições do ensaio e a unidade usada. A tua viagem pode ter outro consumo.',
    options: ['Versão do carro', 'Condições do ensaio', 'Unidade da medição'],
    cta: 'Qual destes dados procuras primeiro?',
    alternative: { title: 'Leste uma novidade sobre mobilidade elétrica?', cta: 'Que informação gostavas de ver explicada com um exemplo?' } },
  { id: 'eletricos-atualidade-mercado', title: 'Esta novidade já chegou a Portugal?',
    body: 'Ao ler notícias sobre elétricos, procura o mercado a que se referem e a data prevista. Um anúncio internacional pode ter outro calendário em Portugal.',
    options: ['Mercado referido', 'Data da notícia', 'Calendário nacional'],
    cta: 'Que novidade gostavas de experimentar em Portugal?',
    alternative: { title: 'Como lês as notícias sobre elétricos?', cta: 'O que costumas confirmar antes de partilhar uma novidade?' } },
];

// Twenty editions take 50 days. The 5-day pattern also rotates through all 42 original topics.
function featureFor(index, date) {
  const slot = index % 20;
  if (slot === 0 || slot === 10) {
    const card = grants[slot === 0 ? 0 : 1];
    if (date >= '2028-01-01' && slot === 0) return { kind: 'grant', label: 'APOIOS À MOBILIDADE ELÉTRICA',
      card: { ...card, title: 'Onde confirmas um incentivo à compra?' } };
    return { kind: 'grant', label: 'APOIOS À MOBILIDADE ELÉTRICA', card };
  }
  if (slot === 1 || slot === 11) return { kind: 'news', label: 'LER A ATUALIDADE ELÉTRICA', card: news[slot === 1 ? 0 : 1] };
  const skipped = [0, 1, 10, 11].filter(value => value < slot).length;
  return { kind: 'tip', label: 'DÚVIDAS SOBRE ELÉTRICOS', card: ELECTRIC_TIPS[(6 + slot - skipped) % ELECTRIC_TIPS.length] };
}

export function scheduledEditorialPlan(date) {
  const original = editorialPlan(date);
  const day = (Date.parse(date + 'T00:00:00Z') - START) / DAY;
  if (day < 0 || original.format === 'REELS') return original;
  // Six launch cards surround the approved 29 November Reel. Then resume the mixed calendar.
  const recurringDay = day - 7;
  if (recurringDay >= 0 && ![0, 2].includes(recurringDay % 5)) return original;
  const index = Math.floor(recurringDay / 5) * 2 + (recurringDay % 5 === 2 ? 1 : 0);
  const { kind, label, card } = recurringDay < 0
    ? { kind: 'tip', label: 'FAZ AS CONTAS AO ELÉTRICO', card: ELECTRIC_TIPS[day < 3 ? day : day - 1] }
    : featureFor(index, date);
  const { title, body, options, cta } = card;
  const slide = { kind: 'question', label, title, body, options: [...options], cta, layout: day % 3,
    altText: ['AutoValorPT.', label + '.', title, body, options.join(', ') + '.', cta, 'Simula em carregador.vercel.app.'].join(' ') };
  const post = { id: 'editorial-' + date + '-' + card.id, date, version: ELECTRIC_IMAGE_VERSION, format: 'IMAGE',
    topic: label, topicId: card.id, title, slides: [slide], electric: kind,
    alternative: { ...card.alternative }, simulatorUrl: SIMULATOR_URL,
    ...(card.id === 'eletrico-usado-orcamento' ? { creditSimulatorUrl: CREDIT_SIMULATOR_URL } : {}) };
  return { ...post, caption: [title, body, cta, simulatorCaption(post), signature].join('\n\n') };
}

export { signature as electricSignature };
