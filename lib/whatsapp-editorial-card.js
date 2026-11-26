import { CREDIT_SIMULATOR_URL, ELECTRIC_IMAGE_VERSION } from './electric-editorial-calendar.js';
import { simulatorForTopic } from './editorial-simulator.js';

// This identifier is part of the public URL and its immutable cache key.
export const WHATSAPP_IMAGE_VARIANT = 'wa1';

export function whatsappCardContent(plan, index) {
  const slide = plan.slides[index];
  const tool = simulatorForTopic(plan.topicId);
  let url = tool?.url;
  if (plan.version === ELECTRIC_IMAGE_VERSION && plan.electric === 'tip')
    url = plan.creditSimulatorUrl || plan.simulatorUrl;

  let summary = slide.takeaway || slide.body;
  if (plan.topicId === 'extra-quarenta-e-dois-km') {
    summary = 'Inclui os desvios para a escola ou para as compras nos quilómetros do mês. Compara o mesmo percurso com os preços que pagas por kWh e por litro.';
  } else if (url === CREDIT_SIMULATOR_URL) {
    summary = 'Experimenta o montante e o prazo que tens em mente. Junta a prestação estimada à despesa mensal de energia para veres quanto sobra no teu orçamento.';
  } else if (url) {
    summary = 'Faz a conta para a mesma distância nos dois carros. Usa os consumos que observaste no teu percurso e os preços do teu último carregamento e abastecimento.';
  } else if (slide.kind === 'cover' && plan.slides[index + 1]) {
    summary = plan.slides[index + 1].body;
  } else if (slide.kind === 'question') {
    summary = plan.alternative?.cta || slide.body + ' ' + slide.cta;
  }
  return { summary, url, toolTitle: url === CREDIT_SIMULATOR_URL ? 'Simula a tua prestação' : 'Compara os teus custos por 100 km' };
}
