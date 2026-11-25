import { extraEditorialPlan } from './editorial-content.js';
import { ADVICE_START_DATE, adviceFor } from './editorial-advice-content.js';
import { electricSignature, scheduledEditorialPlan, simulatorCaption, SIMULATOR_URL } from './electric-editorial-calendar.js';

export const ADVICE_IMAGE_VERSION = 'v3';
const DAY = 86_400_000;

const FEATURES = {
  'apoios-eletricos-aviso': {
    category: 'APOIOS EM PORTUGAL', title: 'O apoio já pode entrar no teu orçamento?',
    body: 'Uma proposta anuncia uma intenção. Para decidires se podes contar com o incentivo, procura o aviso de abertura e lê as condições para a tua compra.',
    takeaway: 'Faz primeiro a simulação com o preço que pagarias sem apoio. Guarda o aviso que fundamenta o segundo cenário.',
    rows: [['Programa', 'Qual é o aviso?'], ['Candidatura', 'Quem pode pedir?'], ['Compra', 'Que datas contam?']],
  },
  'apoios-eletricos-usado': {
    category: 'APOIOS E USADOS', title: 'O aviso abrange o elétrico usado que escolheste?',
    body: 'Antes de dar sinal, lê a definição de viatura elegível no aviso. Confronta essa definição com a data da primeira matrícula e com os documentos da viatura.',
    takeaway: 'Se o texto deixar dúvidas sobre o teu caso, pede esclarecimento por escrito à entidade do programa.',
    rows: [['Viatura', 'Nova ou usada?'], ['Matrícula', 'Qual é a data?'], ['Compra', 'Que comprovativos?']],
  },
  'eletricos-atualidade-dados': {
    category: 'LER UM ENSAIO', title: 'Essa autonomia serve para a tua viagem?',
    body: 'Dois ensaios do mesmo modelo podem dar distâncias diferentes. Antes de usares o resultado, identifica a bateria da versão testada e o tipo de percurso.',
    takeaway: 'Para planear a primeira paragem, procura um consumo medido em condições parecidas com as da tua viagem.',
    rows: [['Versão', 'Qual é a bateria?'], ['Percurso', 'Cidade ou autoestrada?'], ['Resultado', 'Qual foi o consumo?']],
  },
  'eletricos-atualidade-mercado': {
    category: 'LER UMA NOVIDADE', title: 'O equipamento da notícia existe no usado que viste?',
    body: 'Uma novidade numa gama pode estrear-se só em certas versões ou mercados. Cruza a data e a versão da notícia com a ficha da viatura em Portugal.',
    takeaway: 'Se a tua decisão depender de um equipamento, pede ao vendedor que te mostre essa função na viatura.',
    rows: [['Notícia', 'País e ano'], ['Anúncio', 'Versão exata'], ['Viatura', 'Função demonstrada']],
  },
};

function featureAdvice(previous) {
  const feature = FEATURES[previous.topicId];
  return { id: previous.topicId, ...feature,
    visual: { kind: 'checklist', items: feature.rows.map(([label, value]) => ({ label, value })) } };
}

function ordinaryIndex(day) {
  // The approved Reel occupies day 3. Source editions occupy days 7 and 9 in each 25-day block from day 7.
  const n = Math.max(day - 7, 0);
  const previousFeatures = 2 * Math.floor(n / 25) + Number(n % 25 > 0) + Number(n % 25 > 2);
  return day - Number(day > 3) - previousFeatures;
}

export function adviceEditorialPlan(date, extra = false) {
  const previous = scheduledEditorialPlan(date);
  if (date < ADVICE_START_DATE || (!extra && previous.format === 'REELS')) return extra ? extraEditorialPlan(date) : previous;
  const day = (Date.parse(date) - Date.parse(ADVICE_START_DATE)) / DAY;
  const feature = !extra && ['grant', 'news'].includes(previous.electric);
  const advice = feature ? featureAdvice(previous) : adviceFor(date, extra, extra ? day : ordinaryIndex(day));
  const { title, category, body, takeaway, visual } = advice;
  const altText = [title, body, ...visual.items.map(item => item.label + ', ' + item.value),
    visual.unit && 'Unidade: ' + visual.unit, visual.note, takeaway].filter(Boolean).join(' ');
  const slide = { kind: 'advice', label: category, category, title, body, takeaway, cta: takeaway, visual,
    ...(advice.metric ? { metric: advice.metric, metricLabel: advice.metricLabel } : {}), altText };
  const post = { id: [extra ? 'extra' : 'editorial', date, ADVICE_IMAGE_VERSION, advice.id].join('-'),
    date, version: ADVICE_IMAGE_VERSION, format: 'IMAGE', ...(extra ? { extra: true } : {}), topic: category, topicId: advice.id,
    electric: feature ? previous.electric : 'tip', title, slides: [slide],
    brief: [takeaway, advice.alternative?.title && 'Outro ângulo possível: ' + advice.alternative.title].filter(Boolean).join('\n'),
    facts: [body, 'Na imagem (' + (visual.unit || category.toLocaleLowerCase('pt-PT')) + '): ' +
      visual.items.map(({ label, value }) => label + ' · ' + value).join(' / ') + '.'],
    simulatorUrl: SIMULATOR_URL, ...(advice.id.endsWith('fatura-energia-prestacao') ? { creditSimulatorUrl: 'https://credicarros.vercel.app/simulador-ano.html' } : {}) };
  return { ...post, caption: [title, body, takeaway, simulatorCaption(post), electricSignature].join('\n\n') };
}
