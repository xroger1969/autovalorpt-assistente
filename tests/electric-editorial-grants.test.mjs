import assert from 'node:assert/strict';
import test from 'node:test';
import { readElectricGrantUpdate } from '../lib/electric-editorial-grants.js';

const date = '2026-11-25';
const country = (name, status) => `<li><div class="ecl-list-illustration__title">${name}</div><p>${status}</p></li>`;
const page = (html) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const today = t => t.mock.timers.enable({ apis: ['Date'], now: new Date(`${date}T14:00:00Z`) });

test('country-specific Commission evidence is dated on the actual check, including for a future edition', async t => {
  today(t);
  const calls = [];
  const assessment = country('Portugal', '<mark><strong>submitted</strong></mark> (Commission assessment phase)');
  const adopted = country('Greece', '<a href="/greece">adopted</a>');
  const result = await readElectricGrantUpdate({ date: '2027-01-01', fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return page(`<ul>${adopted}${assessment}</ul>`);
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], result.sources[0].url);
  assert.equal(result.sources[0].date, date);
  assert.equal(result.sources.at(-1).url, 'https://www.fundoambiental.pt/');
  assert.match(result.text, /25\/11\/2026.*em avaliação/);
  assert.match(result.text, /Plano Social para o Clima/);
  assert.match(result.text, /candidaturas abrem por aviso próprio/);
  const changed = await readElectricGrantUpdate({ date, fetchImpl: async () => page(country('Portugal', '<a>adopted</a>')) });
  assert.match(changed.text, /aprovado o Plano Social para o Clima/);
  assert.match(changed.text, /Procura o aviso em vigor/);
});

test('unavailable, ambiguous and changed layouts default to a dated historical fact', async t => {
  today(t);
  for (const result of [page(country('Spain', 'adopted')), page(country('Portugal', 'not adopted')),
    page(country('Portugal', 'adopted') + country('Portugal', 'adopted')), new Response('Unavailable', { status: 503 })]) {
    const update = await readElectricGrantUpdate({ date, fetchImpl: async () => result });
    assert.match(update.text, /Em 9 de outubro de 2026.*apresentou a proposta de Plano Social para o Clima/);
    assert.equal(update.sources[0].date, '2026-10-09');
  }
});

test('archived editions and editions beyond the 2027 scheme do not query a later decision', async t => {
  today(t);
  let calls = 0;
  const fetchImpl = async () => { calls++; return page(country('Portugal', 'adopted')); };
  const archived = await readElectricGrantUpdate({ date: '2026-11-01', fetchImpl });
  assert.match(archived.text, /apresentou a proposta/);
  const future = await readElectricGrantUpdate({ date: '2028-01-01', fetchImpl });
  assert.doesNotMatch(future.text, /2027|2026|aprovação/);
  assert.equal(calls, 0);
});
