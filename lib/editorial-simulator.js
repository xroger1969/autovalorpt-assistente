import { ADVICE_IMAGE_VERSION, adviceEditorialPlan } from './editorial-advice-calendar.js';
import { CREDIT_SIMULATOR_URL, electricSignature, SIMULATOR_URL, simulatorCaption } from './electric-editorial-calendar.js';

export const SIMULATOR_IMAGE_VERSION = 'v4';
// The extra published on launch morning keeps its archived artwork.
export function navyEdition(day, extra, version) {
  return ['v3', 'v4'].includes(version) && day >= (extra ? '2026-11-27' : '2026-11-26');
}

const costTopics = new Set([
  'tarifa-de-equilibrio', 'tarifa-mista', 'consumo-autoestrada', 'taxa-por-sessao',
  'poupanca-ano-completo', 'uma-semana-de-dados', 'licao-contador-tomada', 'registo-dos-abastecimentos',
  'horario-carregamento', 'comparar-dois-usados', 'extra-quarenta-e-dois-km', 'extra-cruzar-duas-tarifas',
  'extra-plug-in-duas-medias', 'extra-dois-carros-casa', 'extra-energia-por-euro',
  'extra-poupanca-sensibilidade-combustivel', 'extra-cartao-preco-final', 'extra-escola-dias-uteis',
  'extra-orcamento-familiar',
]);
const cost = { title: 'Simula o custo por 100 km', url: SIMULATOR_URL,
  lead: 'Compara o custo por 100 km no link do perfil @autovalorpt.' };
const credit = { title: 'Simula a tua prestação', url: CREDIT_SIMULATOR_URL,
  lead: 'Simula a tua prestação no link do perfil @autovalorpt.' };

export function simulatorForTopic(topic) {
  if (topic === 'fatura-energia-prestacao') return credit;
  if (costTopics.has(topic)) return cost;
}

function feedCopy(post, tool) {
  const lead = post.topicId === 'extra-quarenta-e-dois-km'
    ? '42 km por dia? Simula os teus custos no link do perfil @autovalorpt.' : tool.lead;
  const oldFooter = '\n\n' + simulatorCaption(post) + '\n\n' + electricSignature;
  const text = post.caption.endsWith(oldFooter) ? post.caption.slice(0, -oldFooter.length) : post.caption;
  const links = tool === credit ? tool.url + '\n\nComparador de custos de energia\n' + SIMULATOR_URL : tool.url;
  const { body, takeaway, visual } = post.slides[0];
  // Keep units and labels together when the figures on the chart add detail to the caption.
  const assumptions = text.includes(body) ? '' : body;
  const figures = visual.kind === 'compare' && visual.unit && visual.items.some(item => !text.includes(item.value))
    ? ['Neste exemplo (' + visual.unit + ')', ...visual.items.map(item => item.label + ' · ' + item.value)].join('\n') : '';
  const join = (...parts) => parts.filter(Boolean).join('\n\n');
  let caption = join(lead, text, assumptions, figures, links, electricSignature);
  if (caption.length > 2200 && !assumptions) caption = join(lead, text, links, electricSignature);
  if (caption.length <= 2200) return { caption };
  // An older, long-form draft can already be at the Instagram limit. These cost topics
  // have a complete authored explanation; keep it intact instead of clipping a condition.
  return { caption: join(lead, body, figures, takeaway, links, electricSignature), copyOrigin: 'editorial', copyModel: undefined };
}

export function withSimulatorAccess(post) {
  if (post.version !== ADVICE_IMAGE_VERSION) return post;
  const tool = simulatorForTopic(post.topicId);
  if (!tool) return post;
  const slide = post.slides[0];
  return { ...post, version: SIMULATOR_IMAGE_VERSION, id: post.id.replace('-v3-', '-v4-'),
    ...feedCopy(post, tool), feedTool: { title: tool.title, url: tool.url },
    slides: [{ ...slide, altText: slide.altText + ' ' + tool.title + '. Link no perfil @autovalorpt. Código QR para ' + tool.url }] };
}

export function feedEditorialPlan(day, extra = false) {
  return withSimulatorAccess(adviceEditorialPlan(day, extra));
}

// The private history can offer wording for a caption edit while keeping the sent text as recorded.
export function captionSuggestion(item) {
  if (item.status !== 'published' || item.version !== ADVICE_IMAGE_VERSION || typeof item.caption !== 'string' || !item.caption.trim()) return item;
  const tool = simulatorForTopic(item.topicId);
  if (!tool) return item;
  // Older history is read as stored, even when its dated artwork cannot be reconstructed.
  let original;
  try { original = adviceEditorialPlan(item.date, item.extra === true); }
  catch { return item; }
  if (item.id !== original.id || item.topicId !== original.topicId) return item;
  return { ...item, suggestedCaption: feedCopy({ ...original, caption: item.caption }, tool).caption };
}
