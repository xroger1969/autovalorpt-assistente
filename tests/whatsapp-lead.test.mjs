import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppTemplatePayload, getWhatsAppConfig, sendWhatsAppLead } from '../lib/whatsapp-lead.js';

const env = {
  WHATSAPP_ACCESS_TOKEN: 'secret-token',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_ALERT_TO: '+351 918 404 101',
  WHATSAPP_TEMPLATE_NAME: 'autovalorpt_novo_lead',
  WHATSAPP_TEMPLATE_LANGUAGE: 'pt_PT',
  WHATSAPP_GRAPH_VERSION: 'v23.0'
};

const lead = {
  name: 'Rita Silva',
  phone: '918303356',
  vehicle: 'Tesla Model Y Performance',
  subjects: 'Financiamento',
  financing: '13900€ entrada 84 meses',
  tradeIn: '',
  registration: '',
  visit: '',
  observations: ''
};

test('WhatsApp fica inativo de forma segura quando faltam credenciais', () => {
  const config = getWhatsAppConfig({});
  assert.equal(config.configured, false);
  assert.ok(config.missing.includes('WHATSAPP_ACCESS_TOKEN'));
  assert.ok(config.missing.includes('WHATSAPP_PHONE_NUMBER_ID'));
  assert.ok(config.missing.includes('WHATSAPP_ALERT_TO'));
  assert.ok(config.missing.includes('WHATSAPP_TEMPLATE_NAME'));
  assert.ok(config.missing.includes('WHATSAPP_GRAPH_VERSION'));
});

test('normaliza destinatário e constrói payload de template', () => {
  const config = getWhatsAppConfig(env);
  const payload = buildWhatsAppTemplatePayload(lead, config);

  assert.equal(config.configured, true);
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '351918404101');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'autovalorpt_novo_lead');
  assert.equal(payload.template.language.code, 'pt_PT');
  assert.deepEqual(
    payload.template.components[0].parameters.map((item) => item.text),
    ['Rita Silva', '918303356', 'Tesla Model Y Performance', 'Financiamento', 'Financiamento: 13900€ entrada 84 meses']
  );
});

test('não chama a Meta quando WhatsApp não está configurado', async () => {
  let called = false;
  const result = await sendWhatsAppLead(lead, {
    env: {},
    fetchImpl: async () => {
      called = true;
      throw new Error('não devia ser chamado');
    }
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.error, 'whatsapp_not_configured');
});

test('falha da Meta é isolada e devolvida sem lançar exceção', async () => {
  const result = await sendWhatsAppLead(lead, {
    env,
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 132001, type: 'OAuthException', message: 'Template does not exist' } })
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'whatsapp_failed');
  assert.equal(result.status, 400);
  assert.equal(result.code, 132001);
});

test('envio válido usa endpoint da Graph API e devolve o id da mensagem', async () => {
  let request;
  const result = await sendWhatsAppLead(lead, {
    env,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: 'wamid.test123' }] })
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, 'wamid.test123');
  assert.equal(request.url, 'https://graph.facebook.com/v23.0/123456789/messages');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  const sent = JSON.parse(request.options.body);
  assert.equal(sent.to, '351918404101');
  assert.equal(sent.template.name, 'autovalorpt_novo_lead');
});
