import { electricSignature, simulatorCaption } from './electric-editorial-calendar.js';
import { chooseElectricEditorialAngle } from './electric-editorial-ai.js';
import { readElectricGrantUpdate } from './electric-editorial-grants.js';
import { readAcpElectricNews } from './electric-editorial-sources.js';

const displayDate = day => day.split('-').reverse().join('/');

export async function prepareElectricEdition(post, { env = process.env, fetchImpl = fetch } = {}) {
  const card = post.slides[0];
  let update = '';
  let sources = [];
  if (post.electric === 'news') {
    const article = await readAcpElectricNews({ date: post.date, fetchImpl });
    if (article) {
      update = 'Na revista ACP de ' + displayDate(article.date) + ' · ' + article.title;
      sources = [{ label: 'Revista ACP', date: article.date, url: article.url }];
    }
  }
  if (post.electric === 'grant') {
    const grant = await readElectricGrantUpdate({ date: post.date, fetchImpl });
    update = grant.text;
    sources = grant.sources;
  }
  const angles = [{ id: 'original', title: card.title, cta: card.cta },
    { id: 'alternative', ...post.alternative }];
  const selected = await chooseElectricEditorialAngle({ topic: card.title,
    facts: [card.body, ...(update ? [update] : [])], angles, env, fetchImpl });
  const caption = [selected.title, card.body, update, ...sources.map(source => source.label + ' · ' + source.url),
    selected.cta, simulatorCaption(post), electricSignature].filter(Boolean).join('\n\n');
  return { caption, sources };
}
