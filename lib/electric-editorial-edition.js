import { electricSignature, simulatorCaption } from './electric-editorial-calendar.js';
import { generateElectricEditorialCopy } from './electric-editorial-ai.js';
import { readElectricGrantUpdate } from './electric-editorial-grants.js';
import { readAcpElectricNews } from './electric-editorial-sources.js';

const displayDate = day => day.split('-').reverse().join('/');

export async function prepareElectricEdition(post, { env = process.env, fetchImpl = fetch, onStatus } = {}) {
  const card = post.slides[0];
  let update = '';
  let sources = [];
  if (post.electric === 'news') {
    const article = await readAcpElectricNews({ date: post.date, fetchImpl });
    if (article) {
      update = 'Para ler na Revista ACP (' + displayDate(article.date) + ') · ' + article.title;
      sources = [{ label: 'Revista ACP', date: article.date, url: article.url }];
    }
  }
  if (post.electric === 'grant') {
    const grant = await readElectricGrantUpdate({ date: post.date, fetchImpl });
    update = grant.text;
    sources = grant.sources;
  }
  const footer = [update, ...sources.map(source => source.label + ' · ' + source.url), simulatorCaption(post), electricSignature];
  const join = lines => lines.filter(Boolean).join('\n\n');
  const fallback = { caption: join([card.title, card.body, card.takeaway || card.cta, ...footer]), sources, copyOrigin: 'editorial' };
  // Regulatory status, news headlines and source URLs are appended verbatim outside the model.
  if (post.version !== 'v3') return fallback;
  let status;
  const copy = await generateElectricEditorialCopy({ title: card.title, brief: post.brief || card.takeaway,
    facts: post.facts, env, fetchImpl, onStatus: info => { status = info; onStatus?.(info); } });
  if (!copy) return fallback;
  const caption = join([copy.hook, copy.body, copy.question, ...footer]);
  return caption.length <= 2200 ? { caption, sources, copyOrigin: 'ai', copyModel: status?.model } : fallback;
}
