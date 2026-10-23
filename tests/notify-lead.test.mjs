import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createNotifyLeadHandler, legacyRequestId, parseLegacyLead } from '../api/notify-lead.js';
import { ADMIN_COOKIE_NAME, createAdminSession, hashAdminToken } from '../lib/admin-security.js';
import { createLeadRepository, normalizeLead } from '../lib/lead-registry.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const inputLead = () => ({ name: 'Ana Teste', phone: '912345678', vehicle: '', subjects: 'Informação', observations: 'Qual é o horário de atendimento?' });

function response() {
  return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function fixture(options = {}) {
  const memory = memoryBlob();
  const repository = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const env = {
    VERCEL_ENV: 'production', ONESIGNAL_AUTOVALORPT_API_KEY: 'synthetic-provider-key',
    SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/SYNTHETIC/TEST/ONLY',
    ADMIN_ACCESS_HASH: hashAdminToken(randomBytes(32).toString('base64url')),
    ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
    CRON_SECRET: randomBytes(32).toString('base64url'),
    ...options.env
  };
  const outgoing = [];
  const fetchImpl = async (url, settings) => {
    // Every external call is mocked. Assert the persist-before-alert boundary.
    assert.equal([...memory.records.keys()].some((key) => key.includes('/records/')), true);
    assert.equal([...memory.records.keys()].some((key) => key.includes('/inbox/')), true);
    assert.equal([...memory.records.keys()].some((key) => key.includes('/outbox/')), true);
    outgoing.push({ url, settings });
    if (options.fetchImpl) return options.fetchImpl(url, settings);
    return url.includes('onesignal') ? new Response(JSON.stringify({ id: 'synthetic-id' })) : new Response('ok');
  };
  const handler = createNotifyLeadHandler({ repository, env, fetchImpl, ...options.handler });
  const invoke = async ({ method = 'POST', body, query = {}, headers = {} } = {}) => {
    const res = response();
    await handler({ method, body, query, headers: { host: 'example.test', origin: 'https://example.test', ...headers } }, res);
    return res;
  };
  const adminHeaders = () => ({ cookie: `${ADMIN_COOKIE_NAME}=${encodeURIComponent(createAdminSession(env))}` });
  return { memory, repository, env, outgoing, invoke, adminHeaders };
}

function submission(lead = inputLead()) { return { requestId: randomUUID(), lead, photoSession: null }; }

test('falha no armazenamento nunca envia avisos nem devolve confirmação de receção', async () => {
  const setup = fixture();
  setup.memory.faults.put = (path) => path.includes('/records/');
  const result = await setup.invoke({ body: submission() });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.persisted, false);
  assert.equal(setup.outgoing.length, 0);
});

test('uma falha do índice é recuperada pelo mesmo pedido sem duplicar o contacto', async () => {
  const setup = fixture();
  const body = submission();
  setup.memory.faults.put = (path) => path.includes('/inbox/');
  assert.equal((await setup.invoke({ body })).statusCode, 503);
  assert.equal(setup.outgoing.length, 0);
  setup.memory.faults.put = null;
  const recovered = await setup.invoke({ body });
  assert.equal(recovered.body.persisted, true);
  assert.equal([...setup.memory.records.keys()].filter((path) => path.includes('/records/')).length, 1);
  assert.equal(setup.outgoing.length, 2);
});

test('pedido geral ou pergunta livre recebe referência persistente sem escolher viatura', async () => {
  const setup = fixture();
  const result = await setup.invoke({ body: submission({ ...inputLead(), subjects: '', phone: '+351 912 345 678' }) });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.persisted, true);
  assert.match(result.body.leadId, /^[a-f0-9]{32}$/);
  assert.match(result.body.receipt, /^CV-\d{8}-[A-F0-9]{8}$/);
  assert.equal(result.body.notifications.onesignal.status, 'accepted');
  const record = await setup.repository.loadRecord(result.body.leadId);
  assert.equal(record.phone, '912345678');
  assert.equal(record.vehicle, '');
  assert.equal(record.observations, 'Qual é o horário de atendimento?');
  assert.equal(JSON.stringify(result.body).includes('912345678'), false);
  assert.equal(JSON.stringify(result.body).includes('synthetic-id'), false);
});

test('um contacto com dez algarismos é recusado integralmente', async () => {
  const setup = fixture();
  const result = await setup.invoke({ body: submission({ ...inputLead(), phone: '9123456789' }) });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.persisted, false);
  assert.equal(setup.memory.records.size, 0);
  assert.equal(setup.outgoing.length, 0);
});

test('repetições concorrentes enviam um único aviso por canal e partilham a referência', async () => {
  const setup = fixture();
  const body = submission();
  const responses = await Promise.all(Array.from({ length: 5 }, () => setup.invoke({ body })));
  assert.ok(responses.every((res) => res.body.persisted === true));
  assert.equal(new Set(responses.map((res) => res.body.leadId)).size, 1);
  assert.equal(new Set(responses.map((res) => res.body.receipt)).size, 1);
  assert.equal(setup.outgoing.filter((call) => call.url.includes('onesignal')).length, 1);
  assert.equal(setup.outgoing.filter((call) => call.url.includes('slack')).length, 1);
});

test('não se pode alterar os dados de um identificador de pedido já guardado', async () => {
  const setup = fixture();
  const body = submission();
  const first = await setup.invoke({ body });
  const changed = await setup.invoke({ body: { ...body, lead: { ...body.lead, phone: '913456789' } } });
  assert.equal(changed.statusCode, 409);
  assert.equal((await setup.repository.loadRecord(first.body.leadId)).phone, '912345678');
  assert.equal(setup.outgoing.length, 2);
});

test('falhas dos avisos conservam o recibo; configuração de um canal não bloqueia os outros', async () => {
  const setup = fixture({ env: { ONESIGNAL_AUTOVALORPT_API_KEY: '', WHATSAPP_ENABLED: 'true' } });
  const result = await setup.invoke({ body: submission() });
  assert.equal(result.body.persisted, true);
  assert.equal(result.body.notifications.onesignal.status, 'unconfigured');
  assert.equal(result.body.notifications.slack.status, 'accepted');
  assert.equal(result.body.notifications.whatsapp.status, 'unconfigured');
  assert.equal(setup.outgoing.length, 1);
});

test('um estado de aviso que não pôde ser gravado deixa recuperação pendente, não perde o pedido', async () => {
  const setup = fixture();
  setup.memory.faults.put = (path, value) => path.includes('/delivery/') && value.status === 'accepted';
  const result = await setup.invoke({ body: submission() });
  assert.equal(result.body.persisted, true);
  assert.equal(result.body.notifications.slack.status, 'sending');
  assert.equal((await setup.repository.page({ outbox: true })).items.length, 1);
});

test('fotografias inválidas impedem a confirmação e não originam avisos', async () => {
  const setup = fixture({ handler: { attachPhotos: async () => { throw Object.assign(new Error('Invalid'), { status: 422, code: 'invalid_photo_session' }); } } });
  const result = await setup.invoke({ body: { ...submission(), photoSession: { batchId: 'a'.repeat(32), uploadToken: 'bad', count: 1 } } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.body.error, 'invalid_photo_session');
  assert.equal(result.body.persisted, false);
  assert.equal(setup.outgoing.length, 0);
});

test('a lista, o detalhe e as alterações administrativas exigem uma sessão válida', async () => {
  const setup = fixture();
  const submitted = await setup.invoke({ body: submission() });
  const id = submitted.body.leadId;
  for (const request of [
    { method: 'GET', query: { action: 'list' } },
    { method: 'GET', query: { action: 'get', id } },
    { body: { action: 'retry', leadId: id } },
    { body: { action: 'status', leadId: id, status: 'closed' } }
  ]) assert.equal((await setup.invoke(request)).statusCode, 401);
  const headers = setup.adminHeaders();
  const listed = await setup.invoke({ method: 'GET', query: { action: 'list' }, headers });
  assert.equal(listed.body.items.length, 1);
  assert.equal(listed.body.items[0].phone, '912345678');
  assert.equal(listed.body.configuration.outboundEnabled, true);
  assert.equal(JSON.stringify(listed.body.configuration).includes('synthetic-provider-key'), false);
  const detail = await setup.invoke({ method: 'GET', query: { action: 'get', id }, headers });
  assert.equal(detail.body.lead.receipt, submitted.body.receipt);
  const closed = await setup.invoke({ body: { action: 'status', leadId: id, status: 'closed' }, headers });
  assert.equal(closed.body.status, 'closed');
  assert.equal((await setup.repository.loadRecord(id)).status, 'closed');
});

test('recuperação automática exige segredo próprio e processa no máximo oito pedidos', async () => {
  const setup = fixture();
  for (let i = 0; i < 10; i++) await setup.repository.saveSubmission({ requestId: randomUUID(), lead: normalizeLead(inputLead()) });
  assert.equal((await setup.invoke({ method: 'GET', query: { action: 'retry-pending' } })).statusCode, 401);
  assert.equal((await setup.invoke({ method: 'GET', query: { action: 'retry-pending' }, headers: setup.adminHeaders() })).statusCode, 401);
  const result = await setup.invoke({ method: 'GET', query: { action: 'retry-pending' }, headers: { authorization: `Bearer ${setup.env.CRON_SECRET}` } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.processed, 8);
  assert.equal(result.body.failed, 0);
  assert.equal((await setup.repository.page({ outbox: true })).items.length, 2);
});

test('corpos grandes, origem externa e métodos não suportados são recusados', async () => {
  const setup = fixture();
  assert.equal((await setup.invoke({ body: { padding: 'a'.repeat(25 * 1024) } })).statusCode, 413);
  assert.equal((await setup.invoke({ body: submission(), headers: { origin: 'https://external.example' } })).statusCode, 403);
  assert.equal((await setup.invoke({ method: 'DELETE' })).statusCode, 405);
  assert.equal(setup.outgoing.length, 0);
});

test('compatibilidade do texto antigo conserva perguntas e usa identidade sem janela temporal', async () => {
  const setup = fixture();
  const text = 'Olá Carlos, venho do assistente AutoValorPT.\nNome: Ana Teste\nContacto: +351 912 345 678\nObservações: Pedido de informação: Qual é o horário?';
  const parsed = parseLegacyLead(text);
  assert.match(parsed.observations, /Qual é o horário/);
  assert.equal(legacyRequestId(parsed), legacyRequestId(parseLegacyLead(text)));
  const first = await setup.invoke({ body: { text } });
  const second = await setup.invoke({ body: { text } });
  assert.equal(first.body.persisted, true);
  assert.equal(first.body.leadId, second.body.leadId);
  assert.equal(setup.outgoing.length, 2);
});
