import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLeadRepository, normalizeLead } from '../lib/lead-registry.js';
import { buildPushPayload, buildSlackMessage, createNotificationService, notificationConfiguration, outboundEnabled, privateLeadUrl, publicNotificationStatuses, sendOneSignalLead, sendSlackLead } from '../lib/lead-notifications.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const env = { VERCEL_ENV: 'production', ONESIGNAL_AUTOVALORPT_API_KEY: 'synthetic-provider-key', SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/SYNTHETIC/TEST/ONLY' };
const lead = { id: 'a'.repeat(32), name: 'Ana Teste', phone: '912345678', vehicle: 'Peugeot e-2008', observations: 'Horário e garantia?', photos: { count: 3 } };

async function fixture(environment = env, fetchImpl = async (url) => url.includes('onesignal') ? new Response(JSON.stringify({ id: 'provider-test-id' }), { status: 200 }) : new Response('ok')) {
  const memory = memoryBlob();
  const repository = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const record = await repository.saveSubmission({ requestId: randomUUID(), lead: normalizeLead(lead) });
  const service = createNotificationService({ repository, env: environment, fetchImpl, timeoutMs: 20 });
  return { memory, repository, record, service };
}

test('push contém apenas um aviso genérico e identificador opaco, sem dados do cliente', () => {
  const payload = buildPushPayload(lead);
  const text = JSON.stringify(payload);
  for (const privateValue of [lead.name, lead.phone, lead.vehicle, lead.observations]) assert.equal(text.includes(privateValue), false);
  assert.deepEqual(payload.data, { leadId: lead.id });
  assert.equal(new URL(payload.url).pathname, '/leads.html');
  assert.deepEqual([...new URL(payload.url).searchParams.keys()], ['lead']);
  assert.equal(buildPushPayload(lead).idempotency_key, payload.idempotency_key);
});

test('Slack inclui contacto, observações e ligação privada sem interpretar menções', () => {
  const payload = buildSlackMessage({ ...lead, observations: '<!channel> & detalhes' });
  assert.equal(payload.mrkdwn, false);
  assert.equal(payload.link_names, false);
  assert.match(payload.text, /912345678/);
  assert.match(payload.text, /Fotografias da retoma: 3/);
  assert.match(payload.text, /&lt;!channel&gt; &amp; detalhes/);
  assert.match(payload.text, /leads\.html\?lead=/);
});

test('HTTP 200 sem identificador OneSignal nunca é apresentado como aceite', async () => {
  const result = await sendOneSignalLead(lead, { env, fetchImpl: async () => new Response(JSON.stringify({ errors: ['No recipients'] })) });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, 'onesignal_no_message_id');
});

test('Slack exige confirmação ok; falhas 5xx e respostas perdidas ficam incertas', async () => {
  assert.equal((await sendSlackLead(lead, { env, fetchImpl: async () => new Response('bad', { status: 500 }) })).status, 'unknown');
  assert.equal((await sendSlackLead(lead, { env, fetchImpl: async () => new Response('invalid', { status: 400 }) })).status, 'failed');
  assert.equal((await sendSlackLead(lead, { env, fetchImpl: async () => new Response('unexpected') })).status, 'unknown');
  assert.equal((await sendSlackLead(lead, { env, fetchImpl: async () => new Response('ok') })).status, 'accepted');
});

test('timeout limita transportes bloqueados e conserva a incerteza do Slack', async () => {
  const fetchImpl = () => new Promise(() => {});
  assert.equal((await sendSlackLead(lead, { env, fetchImpl, timeoutMs: 5 })).status, 'unknown');
  assert.equal((await sendOneSignalLead(lead, { env, fetchImpl, timeoutMs: 5 })).status, 'failed');
});

test('sem OneSignal configurado, o Slack continua independente e o contacto fica guardado', async () => {
  let slackCalls = 0;
  const setup = await fixture({ ...env, ONESIGNAL_AUTOVALORPT_API_KEY: '' }, async () => { slackCalls++; return new Response('ok'); });
  const statuses = await setup.service.notify(setup.record);
  assert.equal(statuses.onesignal.status, 'unconfigured');
  assert.equal(statuses.slack.status, 'accepted');
  assert.equal(statuses.whatsapp.status, 'disabled');
  assert.equal(slackCalls, 1);
  assert.ok(await setup.repository.loadRecord(setup.record.id));
});

test('canal aceite não é reenviado quando outro falha e recupera', async () => {
  let pushCalls = 0;
  let slackCalls = 0;
  const setup = await fixture(env, async (url) => {
    if (url.includes('onesignal')) { pushCalls++; return pushCalls === 1 ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ id: 'accepted-id' })); }
    slackCalls++; return new Response('ok');
  });
  assert.equal((await setup.service.notify(setup.record)).onesignal.status, 'failed');
  const recovered = await setup.service.notify(setup.record);
  assert.equal(recovered.onesignal.status, 'accepted');
  assert.equal(recovered.slack.status, 'accepted');
  assert.equal(pushCalls, 2);
  assert.equal(slackCalls, 1);
});

test('Slack incerto só repete com autorização manual explícita', async () => {
  let slackCalls = 0;
  const setup = await fixture(env, async (url) => {
    if (url.includes('onesignal')) return new Response(JSON.stringify({ id: 'accepted-id' }));
    slackCalls++;
    return slackCalls === 1 ? new Response('gateway error', { status: 500 }) : new Response('ok');
  });
  assert.equal((await setup.service.notify(setup.record)).slack.status, 'unknown');
  await setup.service.notify(setup.record);
  await setup.service.notify(setup.record, { manual: true });
  assert.equal(slackCalls, 1);
  assert.equal((await setup.service.notify(setup.record, { manual: true, allowUnknown: true })).slack.status, 'accepted');
  assert.equal(slackCalls, 2);
});

test('pré-visualizações e desenvolvimento não contactam fornecedores por defeito', async () => {
  for (const environment of [{ ...env, VERCEL_ENV: 'preview' }, { ...env, VERCEL_ENV: 'development' }, { ...env, NOTIFICATIONS_ENABLED: 'false' }]) {
    let calls = 0;
    const setup = await fixture(environment, async () => { calls++; throw new Error('Must not send'); });
    const states = await setup.service.notify(setup.record);
    assert.ok(Object.values(states).every((value) => value.status === 'disabled'));
    assert.equal(calls, 0);
  }
  assert.equal(outboundEnabled({ VERCEL_ENV: 'preview', NOTIFICATIONS_PREVIEW_ENABLED: 'true' }), false);
  assert.equal(outboundEnabled({ VERCEL_ENV: 'preview', NOTIFICATIONS_PREVIEW_ENABLED: 'true', VERCEL_URL: 'autovalorpt-test.vercel.app' }), true);
});

test('avisos de Preview explicitamente ativados abrem o mesmo ambiente em todos os canais', async () => {
  const environment = {
    ...env, VERCEL_ENV: 'preview', NOTIFICATIONS_PREVIEW_ENABLED: 'true',
    VERCEL_BRANCH_URL: 'autovalorpt-test-branch.vercel.app', VERCEL_URL: 'autovalorpt-test-build.vercel.app',
    WHATSAPP_ENABLED: 'true', WHATSAPP_ACCESS_TOKEN: 'synthetic-meta-token',
    WHATSAPP_PHONE_NUMBER_ID: '123456789012345', WHATSAPP_ALERT_TO: '351910000001',
    WHATSAPP_TEMPLATE_NAME: 'synthetic_test_template', WHATSAPP_GRAPH_VERSION: 'v23.0'
  };
  const requests = [];
  const setup = await fixture(environment, async (url, options) => {
    requests.push(JSON.parse(options.body));
    if (url.includes('onesignal')) return new Response(JSON.stringify({ id: 'synthetic-push-id' }));
    if (url.includes('facebook')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.synthetic-test' }] }));
    return new Response('ok');
  });
  const statuses = await setup.service.notify(setup.record);
  assert.equal(requests.length, 3);
  assert.ok(Object.values(statuses).every((value) => value.status === 'accepted'));
  for (const request of requests) {
    const serialized = JSON.stringify(request);
    assert.ok(serialized.includes(`https://autovalorpt-test-branch.vercel.app/leads.html?lead=${setup.record.id}`));
    assert.equal(serialized.includes('https://autovalorpt-assistente.vercel.app'), false);
  }
});

test('ligações privadas ignoram destinos inválidos e produção conserva o domínio público', () => {
  for (const VERCEL_URL of [undefined, 'autovalorpt-assistente.vercel.app', 'example.com', 'evil.vercel.app/path', 'user@evil.vercel.app', 'evil.vercel.app?secret=value']) {
    const environment = { VERCEL_ENV: 'preview', NOTIFICATIONS_PREVIEW_ENABLED: 'true', VERCEL_URL };
    assert.equal(outboundEnabled(environment), false);
    assert.throws(() => privateLeadUrl(lead, environment), /preview_url_not_configured/);
  }
  const preview = privateLeadUrl(lead, { VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'invalid', VERCEL_URL: 'autovalorpt-test-build.vercel.app' });
  assert.equal(new URL(preview).hostname, 'autovalorpt-test-build.vercel.app');
  const production = privateLeadUrl(lead, { VERCEL_ENV: 'production', VERCEL_URL: 'autovalorpt-test-build.vercel.app' });
  assert.equal(new URL(production).hostname, 'autovalorpt-assistente.vercel.app');
});

test('resposta pública e estado da configuração nunca revelam credenciais ou IDs de fornecedor', () => {
  const configuration = notificationConfiguration({ ...env, WHATSAPP_ACCESS_TOKEN: 'private-synthetic-token' });
  assert.equal(JSON.stringify(configuration).includes(env.ONESIGNAL_AUTOVALORPT_API_KEY), false);
  assert.equal(JSON.stringify(configuration).includes('private-synthetic-token'), false);
  assert.deepEqual(publicNotificationStatuses({ onesignal: { status: 'accepted', providerId: 'internal-id' } }), {
    onesignal: { status: 'accepted' }, slack: { status: 'pending' }, whatsapp: { status: 'pending' }
  });
});
