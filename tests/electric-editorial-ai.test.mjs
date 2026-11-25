import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseElectricEditorialAngle } from '../lib/electric-editorial-ai.js';

const options = {
  topic: 'Potência no posto', facts: ['A potência depende da viatura e do posto.'],
  angles: [
    { id: 'antes', title: 'Antes da viagem', cta: 'Que dados verificas?' },
    { id: 'no-posto', title: 'Chegaste ao posto?', cta: 'Onde vês a potência?' },
  ], env: { OPENAI_API_KEY: 'synthetic-test-key', OPENAI_MODEL: 'expensive-chat-default' },
};
const output = text => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

test('one short request selects an exact approved angle, using the existing mini model and no external tools', async () => {
  let calls = 0;
  const chosen = await chooseElectricEditorialAngle({ ...options, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-key');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
    assert.equal(body.store, false);
    assert.equal(body.max_output_tokens, 32);
    assert.equal(body.tools, undefined);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema.properties.index.enum, [0, 1]);
    assert.deepEqual(JSON.parse(body.input).factos, options.facts);
    return Response.json(output('{"index":1}'));
  } });
  assert.equal(calls, 1);
  assert.equal(chosen, options.angles[1]);
});

test('unconfigured, disabled, insufficient budget or insufficient verified material selects fallback without network', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected'); };
  for (const override of [{ env: {} }, { env: { ...options.env, EDITORIAL_ELECTRIC_AI_ENABLED: 'false' } },
    { deadline: Date.now() - 1 }, { facts: [] }, { facts: ['x'.repeat(481)] }, { angles: [options.angles[0]] }]) {
    assert.equal(await chooseElectricEditorialAngle({ ...options, ...override, fetchImpl }), options.angles[0]);
  }
  assert.equal(calls, 0);
});

test('refusals, extra text, invalid indices, unexpected shape and unavailable responses cannot alter copy or cause retries', async () => {
  for (const data of [
    { ...output('{"index":1}'), status: 'incomplete' },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'test' }] }] },
    output('{"index":1,"extra":"promessa não verificada"}'), output('{"index":-1}'), output('{"index":2}'),
    output('{"index":"1"}'), output('not json'), { output: [] },
    'too large', 'rate limited', 'unavailable',
  ]) {
    let calls = 0;
    const chosen = await chooseElectricEditorialAngle({ ...options, fetchImpl: async () => {
      calls++;
      if (data === 'unavailable') throw new Error('offline');
      if (data === 'rate limited') return new Response('retry later', { status: 429 });
      if (data === 'too large') return new Response(' '.repeat(17 * 1024));
      return Response.json(data);
    } });
    assert.equal(calls, 1);
    assert.equal(chosen, options.angles[0]);
  }
});

test('a stalled API call respects the publication deadline even if the transport ignores cancellation', async () => {
  let signal;
  const result = await chooseElectricEditorialAngle({ ...options, deadline: Date.now() + 80,
    fetchImpl: async (_url, init) => { signal = init.signal; return new Promise(() => {}); } });
  assert.equal(signal.aborted, true);
  assert.equal(result, options.angles[0]);
});
