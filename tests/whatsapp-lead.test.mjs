import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhatsAppTemplatePayload, getWhatsAppConfig, sendWhatsAppLead } from '../lib/whatsapp-lead.js';

const env = {
  WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'synthetic-token-for-unit-tests',
  WHATSAPP_PHONE_NUMBER_ID: '123456789012345', WHATSAPP_ALERT_TO: '+351 910 000 001',
  WHATSAPP_TEMPLATE_NAME: 'autovalorpt_novo_lead', WHATSAPP_TEMPLATE_LANGUAGE: 'pt_PT', WHATSAPP_GRAPH_VERSION: 'v23.0'
};
const lead = {
  id: 'b'.repeat(32), name: 'Ana Teste', phone: '910000002', vehicle: 'Peugeot e-2008 GT',
  subjects: 'Informação', financing: 'Entrada de 5000 €', tradeIn: 'Renault Clio, 2018, 90000 km',
  registration: 'AA-00-AA', visit: 'Sábado de manhã', observations: 'Pretende saber se aceita retoma', photos: { count: 3 }
};
const fakeResponse = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test('a configuração distingue ativação e campos em falta sem expor valores no diagnóstico', () => {
  const empty = getWhatsAppConfig({});
  assert.equal(empty.enabled, false);
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.missing, ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ALERT_TO', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_GRAPH_VERSION']);
  const ready = getWhatsAppConfig({ ...env, WHATSAPP_ENABLED: 'false' });
  assert.equal(ready.enabled, false);
  assert.equal(ready.configured, true);
  assert.equal(getWhatsAppConfig({ ...env, WHATSAPP_ENABLED: 'TRUE' }).enabled, false);
});

test('nunca chama a Meta quando está desativado ou incompleto', async () => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('must not send'); };
  assert.equal((await sendWhatsAppLead(lead, { env: {}, fetchImpl })).status, 'disabled');
  assert.equal((await sendWhatsAppLead(lead, { env: { WHATSAPP_ENABLED: 'true' }, fetchImpl })).status, 'unconfigured');
  assert.equal(calls, 0);
});

test('valida destinatário, ID, nome do template, idioma e versão antes de enviar', () => {
  for (const [key, value] of [
    ['WHATSAPP_PHONE_NUMBER_ID', '../../messages'], ['WHATSAPP_ALERT_TO', '351phone123'],
    ['WHATSAPP_ALERT_TO', '1234567890123456'], ['WHATSAPP_TEMPLATE_NAME', 'Name With Spaces'],
    ['WHATSAPP_TEMPLATE_LANGUAGE', '../../pt'], ['WHATSAPP_GRAPH_VERSION', 'v23.0/messages'],
    ['WHATSAPP_ACCESS_TOKEN', 'token\r\ninjected']
  ]) assert.ok(getWhatsAppConfig({ ...env, [key]: value }).missing.includes(key), key);
  assert.equal(getWhatsAppConfig({ ...env, WHATSAPP_ALERT_TO: '00351 910 000 001' }).to, '351910000001');
  assert.equal(getWhatsAppConfig({ ...env, WHATSAPP_PHONE_NUMBER_ID: '123456789012345678' }).configured, true);
});

test('o destinatário é sempre o Carlos configurado, nunca o telefone do cliente', () => {
  const payload = buildWhatsAppTemplatePayload(lead, getWhatsAppConfig(env));
  assert.equal(payload.to, '351910000001');
  assert.notEqual(payload.to, lead.phone);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, env.WHATSAPP_TEMPLATE_NAME);
  assert.equal(payload.template.language.code, 'pt_PT');
  const parameters = payload.template.components[0].parameters;
  assert.equal(parameters.length, 5);
  assert.deepEqual(parameters.slice(0, 4).map(item => item.text), [lead.name, lead.phone, lead.vehicle, lead.subjects]);
  assert.match(parameters[4].text, /Fotografias: 3/);
  assert.ok(parameters[4].text.endsWith(`/leads.html?lead=${lead.id}`));
});

test('detalhes extensos preservam a contagem e o link privado dentro de 1024 caracteres', () => {
  const long = { ...lead, financing: 'f'.repeat(500), tradeIn: 't'.repeat(500), visit: 'v'.repeat(500), observations: 'o'.repeat(1600) };
  const details = buildWhatsAppTemplatePayload(long, getWhatsAppConfig(env)).template.components[0].parameters[4].text;
  assert.ok(details.length <= 1024);
  assert.match(details, /Fotografias: 3/);
  assert.ok(details.endsWith(`/leads.html?lead=${lead.id}`));
  assert.equal(details.includes(lead.phone), false);
});

test('sucesso exige um identificador wamid real e significa aceite, não entregue', async () => {
  let request;
  const result = await sendWhatsAppLead(lead, { env, fetchImpl: async (url, options) => {
    request = { url, options };
    return fakeResponse(200, { messages: [{ id: 'wamid.synthetic-unit-test' }] });
  } });
  assert.deepEqual(result, { status: 'accepted', providerId: 'wamid.synthetic-unit-test', httpStatus: 200 });
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456789012345/messages');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`);
  assert.equal(request.options.signal instanceof AbortSignal, true);
  assert.equal(JSON.parse(request.options.body).to, '351910000001');
});

test('HTTP 200 sem wamid, JSON ilegível ou 5xx ficam com entrega desconhecida', async () => {
  for (const response of [
    fakeResponse(200, {}), fakeResponse(200, { messages: [{ id: 'other-id' }] }), fakeResponse(200, { messages: [{ id: 'wamid.' }] }),
    fakeResponse(503, { error: { message: `private data ${lead.phone}` } }),
    { status: 200, ok: true, json: async () => { throw new Error('not json'); } }
  ]) {
    const result = await sendWhatsAppLead(lead, { env, fetchImpl: async () => response });
    assert.equal(result.status, 'unknown');
    assert.equal(JSON.stringify(result).includes(lead.phone), false);
    assert.equal(JSON.stringify(result).includes(env.WHATSAPP_ACCESS_TOKEN), false);
  }
});

test('4xx é falha explícita, com repetição permitida apenas para 429', async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const result = await sendWhatsAppLead(lead, { env, fetchImpl: async () => fakeResponse(status, { error: { message: 'provider detail' } }) });
    assert.equal(result.status, 'failed');
    assert.equal(result.httpStatus, status);
    assert.equal(result.retryable, status === 429);
    assert.equal(result.error, 'whatsapp_rejected');
  }
});

test('exceções de rede não escapam nem revelam mensagens ou tokens do fornecedor', async () => {
  const result = await sendWhatsAppLead(lead, { env, fetchImpl: async () => { throw new Error(`${env.WHATSAPP_ACCESS_TOKEN} ${lead.phone}`); } });
  assert.deepEqual(result, { status: 'unknown', error: 'whatsapp_delivery_unconfirmed' });
});

test('timeout limita fetch que não responde e também a leitura do corpo', async () => {
  for (const never of [
    () => new Promise(() => {}),
    async () => ({ status: 200, ok: true, json: () => new Promise(() => {}) })
  ]) {
    let signal;
    const result = await sendWhatsAppLead(lead, { env, timeoutMs: 15, fetchImpl: (...args) => { signal = args[1].signal; return never(); } });
    assert.equal(result.status, 'unknown');
    assert.equal(result.error, 'whatsapp_timeout');
    assert.equal(signal.aborted, true);
  }
});
