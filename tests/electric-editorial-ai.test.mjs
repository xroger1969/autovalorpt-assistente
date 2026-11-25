import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITORIAL_OPENAI_MODEL, generateElectricEditorialCopy } from '../lib/electric-editorial-ai.js';

const fact = 'Para o mesmo percurso, uma tarifa doméstica de 0,20 €/kWh e um preço de 0,50 €/kWh no posto levam a custos de energia diferentes.';
const inputs = { title: 'Onde carregas durante a semana?', brief: 'Ajuda o leitor a tomar uma decisão prática.',
  facts: [fact, 'O custo da energia depende do consumo e do sítio onde carregas.'],
  env: { OPENAI_API_KEY: 'mock-key', OPENAI_MODEL: 'unrelated-chat-model' } };
const copy = {
  hook: 'Chegas a casa com tempo para carregar ou dependes de uma paragem na rua?',
  body: 'No fim da semana, cruza os recibos com o percurso que fizeste. Repete a comparação com uma semana em que tenhas de carregar fora.',
  question: 'Que parte da tua rotina mudaria mais a conta no fim do mês?',
};
const bodyOf = text => ({ status: 'completed', output: [{ type: 'reasoning', summary: [] },
  { type: 'message', content: [{ type: 'output_text', text }] }] });
const answer = value => Response.json(bodyOf(JSON.stringify(value)));
function fixture(options = {}, supply = async () => answer(copy)) {
  const calls = [], events = [];
  return { events, calls, run: () => generateElectricEditorialCopy({ ...inputs, ...options,
    onStatus: event => events.push(event),
    fetchImpl: (...args) => { calls.push(args); return supply(...args); },
  }) };
}

test('flagship authors original PT-PT narrative, recommendation and question while the exact checked claim is inserted on the server', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { ...copy, body: fact + '\n\n' + copy.body });
  assert.deepEqual(f.events, [{ status: 'generated', model: 'gpt-6.2-astra' }]);
  assert.equal(f.calls.length, 1);
  const [[url, init]] = f.calls;
  const body = JSON.parse(init.body);
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.Authorization, 'Bearer mock-key');
  assert.equal(init.redirect, 'error');
  assert.equal(body.model, DEFAULT_EDITORIAL_OPENAI_MODEL);
  assert.deepEqual(body.reasoning, { effort: 'medium' });
  assert.equal(body.max_output_tokens, 1536);
  assert.equal(body.store, false);
  assert.equal(body.temperature, undefined);
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required, ['hook','body','question']);
  assert.equal(body.input[0].role, 'developer');
  assert.equal(JSON.parse(body.input[1].content).factos[0].texto, fact);
});

test('respects explicit model choice and keeps numeric amounts, units, conditions and editorial order bound to the sources', async () => {
  const original = { hook: 'Imagina que a tua semana muda a meio.',
    body: '{{F2}}\n\nCompara o percurso mais frequente com os teus recibos.\n\n{{F1}}',
    question: 'O que pesaria mais na tua decisão?' };
  const f = fixture({ env: { ...inputs.env, EDITORIAL_OPENAI_MODEL: 'gpt-6.2-sol' }, allowedNumbers: ['0.20','0,50 €/kWh'] }, async () => answer(original));
  assert.deepEqual(await f.run(), { ...original, body: inputs.facts[1] + '\n\nCompara o percurso mais frequente com os teus recibos.\n\n' + fact });
  assert.equal(JSON.parse(f.calls[0][1].body).model, 'gpt-6.2-sol');
  const denied = fixture({ allowedNumbers: [0.2] });
  assert.equal(await denied.run(), null);
  assert.equal(denied.events[0].status, 'unsupported_claim');
});

test('accepts natural invitations and practical conclusions without requiring a canned title or restricted editorial vocabulary', async () => {
  for (const [hook, body, question] of [
    ['Pensa na última vez que escolheste o posto à pressa.', 'Guarda o comprovativo e confronta o total com o que pagarias em casa.', 'O que valorizas mais nessa paragem?'],
    ['E se a tomada de casa ficasse indisponível esta semana?', 'Se a tua rotina mudar, refaz a simulação com a tarifa do posto que utilizarias.', 'Como pesarias a diferença no teu orçamento?'],
    ['Quem partilha o carro contigo ao fim de semana?', 'Anota as deslocações de cada pessoa e compara os períodos em que o carro fica parado.', 'Em que dias terias mais margem para carregar?'],
  ]) {
    const f = fixture({}, async () => answer({ hook, body, question }));
    assert.deepEqual(await f.run(), { hook, body: fact + '\n\n' + body, question });
  }
});

test('rejects additions or changed scope including novel quantities, swapped units, guaranteed savings, unsupported equipment, public incentives and link injection', async () => {
  for (const patch of [
    { question: 'E se poupassem 400 euros por mês?' },
    { body: 'Calcula o preço de 0,50 € por quilómetro.' },
    { body: 'Compara a redução de metade da prestação.' },
    { body: 'Confirma que o teu carro traz uma bomba de calor.' },
    { hook: 'Este elétrico vem com condução autónoma?' },
    { question: 'Queres aproveitar um subsídio municipal na próxima compra?' },
    { body: 'Compara as poupanças garantidas que a oferta assegura.' },
    { body: 'Calcula a tua prestação sem juros.' },
    { question: 'Como aplicarias os quinhentos euros no teu dia a dia?' },
    { question: 'E se forem duas prestações no fim do mês?' },
    { body: 'Compra já enquanto a oferta está ativa.' },
    { question: 'Vais usar o financiamento da Tesla?' },
    { question: 'Queres visitar exemplo.pt?' },
    { body: '{{F3}}\n\n' + copy.body },
    { body: 'Este carro é a escolha certa para a tua família.' },
    { body: '{{F1}}' }, { extra: 'payload' }, { question: copy.hook },
  ]) {
    const f = fixture({}, async () => answer({ ...copy, ...patch }));
    assert.equal(await f.run(), null, JSON.stringify(patch));
    assert.equal(f.events[0].status, 'unsupported_claim', JSON.stringify(patch));
    assert.equal(f.calls.length, 1);
  }
});

test('disabled, unconfigured and invalid inputs do not access the provider', async () => {
  for (const [patch, status] of [
    [{ env: {} }, 'not_configured'], [{ env: { ...inputs.env, EDITORIAL_ELECTRIC_AI_ENABLED: 'false' } }, 'disabled'],
    [{ deadline: Date.now() - 1 }, 'timeout'], [{ facts: [] }, 'invalid_input'],
    [{ facts: ['Use https://x.pt/'] }, 'invalid_input'], [{ facts: ['x'.repeat(761)] }, 'invalid_input'],
    [{ env: { ...inputs.env, EDITORIAL_OPENAI_MODEL: 'https://untrusted.example' } }, 'invalid_input'],
  ]) {
    const f = fixture(patch);
    assert.equal(await f.run(), null);
    assert.equal(f.events[0].status, status);
    assert.equal(f.calls.length, 0);
  }
});

test('provider or format failure returns a sanitized reason with no retry or partial publication copy', async () => {
  for (const [supply, status] of [
    [async () => new Response('secret', { status: 429 }), 'rate_limited'],
    [async () => new Response('secret', { status: 403 }), 'access_denied'],
    [async () => new Response(' '.repeat(49 * 1024)), 'invalid_output'],
    [async () => Response.json({ ...bodyOf('{}'), status: 'incomplete' }), 'incomplete'],
    [async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), 'refused'],
    [async () => Response.json(bodyOf('bad json')), 'invalid_output'],
    [async () => { throw new Error('provider diagnostic must not escape'); }, 'unavailable'],
  ]) {
    const f = fixture({}, supply);
    assert.equal(await f.run(), null);
    assert.deepEqual(f.events, [{ status, model: 'gpt-6.2-astra' }]);
    assert.equal(f.calls.length, 1);
  }
});

test('honors a caller deadline even when transport ignores the abort signal', async () => {
  const f = fixture({ deadline: Date.now() + 150 }, () => new Promise(() => {}));
  assert.equal(await f.run(), null);
  assert.equal(f.calls[0][1].signal.aborted, true);
  assert.equal(f.events[0].status, 'timeout');
});

test('records the effective public model identifier without exposing arbitrary provider metadata', async () => {
  for (const [reported, expected] of [['gpt-6.2-astra-2026-11-20', 'gpt-6.2-astra-2026-11-20'],
    ['ft:gpt-6.2-astra:private-workspace:example', DEFAULT_EDITORIAL_OPENAI_MODEL]]) {
    const f = fixture({}, async () => Response.json({ ...bodyOf(JSON.stringify(copy)), model: reported }));
    assert.ok(await f.run());
    assert.deepEqual(f.events, [{ status: 'generated', model: expected }]);
  }
});

const notFound = () => Response.json({ error: { type: 'invalid_request_error', code: 'model_not_found',
  message: 'synthetic provider detail not for logs' } }, { status: 404 });
const modelList = ids => Response.json({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) });

test('an explicit model rejection allows one generation on the strongest listed compatible model, never the first arbitrary list entry', async () => {
  let generations = 0;
  const f = fixture({}, async (url, init) => {
    if (init.method === 'GET') {
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(init.headers.Authorization, 'Bearer mock-key');
      return modelList(['gpt-5.4-mini', 'gpt-image-2', DEFAULT_EDITORIAL_OPENAI_MODEL, 'private-model', 'gpt-6.2-sol', 'gpt-6.1-sol']);
    }
    if (JSON.parse(init.body).model === DEFAULT_EDITORIAL_OPENAI_MODEL) return notFound();
    assert.equal(JSON.parse(init.body).model, 'gpt-6.2-sol');
    generations++;
    return Response.json({ ...bodyOf(JSON.stringify(copy)), model: 'gpt-6.2-sol-2026-11-20' });
  });
  assert.ok(await f.run());
  assert.equal(generations, 1);
  assert.deepEqual(f.calls.map(([, init]) => init.method), ['POST', 'GET', 'POST']);
  assert.deepEqual(f.events, [{ status: 'generated', model: 'gpt-6.2-sol-2026-11-20', fallbackFrom: DEFAULT_EDITORIAL_OPENAI_MODEL }]);
});

test('an explicit override is never changed, and generic permission or authentication errors never start discovery', async () => {
  for (const [options, respond, status] of [
    [{ env: { ...inputs.env, EDITORIAL_OPENAI_MODEL: DEFAULT_EDITORIAL_OPENAI_MODEL } }, notFound, 'model_not_found'],
    [{}, () => Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 }), 'authentication_failed'],
    [{}, () => Response.json({ error: { code: 'insufficient_permissions', param: 'endpoint' } }, { status: 403 }), 'access_denied'],
    [{}, () => Response.json({ id: 'resp_partial', error: { code: 'model_not_found' } }, { status: 404 }), 'unavailable'],
    [{}, () => Response.json({ error: { code: 'model_not_found' } }, { status: 500 }), 'unavailable'],
  ]) {
    const f = fixture(options, async () => respond());
    assert.equal(await f.run(), null);
    assert.equal(f.calls.length, 1);
    assert.equal(f.events[0].status, status);
  }
});

test('selection accepts dated public snapshots, a second rejected model is terminal, and there is no discovery loop', async () => {
  let sends = 0;
  const f = fixture({}, async (_url, init) => {
    if (init.method === 'GET') return modelList(['gpt-5.4-pro', 'gpt-5.5-2026-04-23', 'gpt-5.5-2026-02-01', 'ft:private', 'gpt-5.4']);
    sends++;
    if (sends === 1) return Response.json({ error: { code: 'model_access_denied' } }, { status: 403 });
    assert.equal(JSON.parse(init.body).model, 'gpt-5.5-2026-04-23');
    return notFound();
  });
  assert.equal(await f.run(), null);
  assert.deepEqual(f.events, [{ status: 'model_not_found', model: 'gpt-5.5-2026-04-23', fallbackFrom: DEFAULT_EDITORIAL_OPENAI_MODEL }]);
  assert.equal(f.calls.length, 3);
});

test('discovery failures and incompatible catalogs return safe diagnostics without another output request', async () => {
  for (const [catalog, status] of [
    [() => modelList(['gpt-5.4-pro', 'gpt-image-2', 'ft:private-project']), 'no_supported_model'],
    [() => Response.json({ data: {} }), 'catalog_unavailable'],
    [() => new Response('private message', { status: 401 }), 'authentication_failed'],
  ]) {
    const f = fixture({}, async (_url, init) => init.method === 'GET' ? catalog() : notFound());
    assert.equal(await f.run(), null);
    assert.deepEqual(f.calls.map(([, init]) => init.method), ['POST', 'GET']);
    assert.equal(f.events[0].status, status);
    assert.doesNotMatch(JSON.stringify(f.events), /private-project|private message/);
  }
});

test('a model listing returned after the shared request deadline cannot trigger a late generation', async () => {
  let finishListing;
  const f = fixture({ deadline: Date.now() + 150 }, async (_url, init) => {
    if (init.method === 'GET') return new Promise(resolve => { finishListing = resolve; });
    return notFound();
  });
  assert.equal(await f.run(), null);
  finishListing(modelList(['gpt-6.2-sol']));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.events[0].status, 'timeout');
  assert.deepEqual(f.calls.map(([, init]) => init.method), ['POST', 'GET']);
});
