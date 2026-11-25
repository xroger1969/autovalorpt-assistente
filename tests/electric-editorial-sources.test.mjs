import test from 'node:test';
import assert from 'node:assert/strict';
import { readAcpElectricNews } from '../lib/electric-editorial-sources.js';

const index = 'https://www.acp.pt/o-clube/revista-acp/atualidade';
const prefix = '/o-clube/revista-acp/atualidade/detalhe/';
const date = '2026-11-25';
function card(slug, day, title, excerpt = '') {
  return `<div class="big-item"><a href='${slug.startsWith('/') || slug.includes(':') ? slug : prefix + slug}'><div class="thumb"><img src="test.jpg" /></div>
    <time>${day}</time><h4>${title}</h4><p>${excerpt}</p></a></div>`;
}
const listing = cards => '<div class="news-columns">' + cards.join('') + '</div><div class="pagination"></div>';
const html = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('selects the newest evidenced electrification article from the fixed ACP index with one request', async () => {
  const cards = [
    card('old', '15 novembro 2026', 'Onde ficam os postos de carregamento?'),
    card('petrol', '25 novembro 2026', 'Preços da gasolina'),
    card('carrinha', '24 novembro 2026', 'Carrinha &amp; empresa', 'Um novo modelo reforça a gama de furgões elétricos.'),
    card('later-on-page', '24 novembro 2026', 'Novos carros elétricos'),
    card('future', '26 novembro 2026', 'Novos carros elétricos'),
  ];
  const seen = [];
  const value = await readAcpElectricNews({ date, fetchImpl: async (url, options) => {
    seen.push(url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return html(listing(cards));
  } });
  assert.deepEqual(seen, [index]);
  assert.deepEqual(value, { title: 'Carrinha & empresa', date: '2026-11-24', url: 'https://www.acp.pt' + prefix + 'carrinha' });
});

test('applies a 14-calendar-day window inclusive of the reference day and validates Portuguese dates', async () => {
  const read = dateText => readAcpElectricNews({ date: '2028-03-01', fetchImpl: async () => html(listing([card('ev', dateText, 'Carros 100% elétricos')])) });
  assert.equal((await read('17 fevereiro 2028')).date, '2028-02-17');
  assert.equal((await read('29 fevereiro 2028')).date, '2028-02-29');
  assert.equal((await read('1 março 2028')).date, '2028-03-01');
  for (const day of ['16 fevereiro 2028', '30 fevereiro 2028', '2 março 2028', 'fevereiro 2028', '0 março 2028']) assert.equal(await read(day), null);
  assert.equal(await readAcpElectricNews({ date: '2026-02-31', fetchImpl: () => assert.fail('Invalid date accessed the network') }), null);
});

test('accepts only canonical ACP article paths and clean visible article text', async () => {
  const cards = [
    ...['https://not-acp.example' + prefix + 'ev', '//evil.test/doc', 'https://acp.pt' + prefix + 'ev', prefix + '%2e%2e/ev',
      prefix + 'ev?tracking=x', prefix + 'ev#anchor', prefix + 'foo/../ev', '/o-clube/revista-acp/page/2',
    ].map(url => card(url, '25 novembro 2026', 'Carros elétricos')),
    card('markup', '25 novembro 2026', 'Carros <b>elétricos</b>'),
    card('injected', '25 novembro 2026', 'Carros elétricos &#60;script&#62;'),
    card('unknown-entity', '25 novembro 2026', 'Carros elétricos &constructor;'),
    card('petrol', '25 novembro 2026', 'Roubo de cabos elétricos', 'O preço dos combustíveis também subiu.'),
    card('cross', '25 novembro 2026', 'Outra notícia'),
  ];
  const noise = card('outside', '25 novembro 2026', 'Carros elétricos');
  const value = await readAcpElectricNews({ date, fetchImpl: async () => html(noise + listing([...cards, '<!--' + noise + '-->', '<template>' + noise + '</template>']) + noise) });
  assert.equal(value, null);
});

test('outages, changed layouts and large or unexpected responses fall back without further requests', async () => {
  const valid = listing([card('ok', '25 novembro 2026', 'Novos veículos elétricos')]);
  const redirected = html(valid);
  Object.defineProperty(redirected, 'url', { value: 'https://unrelated.example/' });
  for (const make of [() => redirected, () => new Response(valid, { status: 503 }), () => new Response(valid, { headers: { 'content-type': 'text/plain' } }),
    () => html('x'.repeat(800 * 1024) + valid), () => html(valid.replace('news-columns', 'other')), () => { throw new Error('offline'); }]) {
    let calls = 0;
    assert.equal(await readAcpElectricNews({ date, fetchImpl: async () => { calls++; return make(); } }), null);
    assert.equal(calls, 1);
  }
});
