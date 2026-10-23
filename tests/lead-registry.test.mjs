import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createLeadRepository, leadIdForRequest, leadNamespace, normalizeLead, normalizeLeadPhone } from '../lib/lead-registry.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const validLead = () => normalizeLead({ name: 'Ana Teste', phone: '+351 912 345 678', observations: 'Qual é o horário de atendimento?' });

test('valida o contacto completo e aceita pedidos sem uma viatura escolhida', () => {
  for (const invalid of ['9123456789', '+3519123456789', '003519123456789', '91234567', '+44912345678', '912abc345678']) assert.equal(normalizeLeadPhone(invalid), '');
  for (const valid of ['912345678', '+351 912 345 678', '00351 912 345 678', '351912345678']) assert.equal(normalizeLeadPhone(valid), '912345678');
  assert.equal(validLead().vehicle, '');
  assert.equal(normalizeLead({ name: 'Ana', phone: '912345678' }), null);
  assert.equal(normalizeLead(null), null);
  assert.equal(normalizeLead({ name: '--', phone: '912345678', subjects: 'Informação' }), null);
});

test('identificadores são estáveis por pedido e isolados entre produção e previews', () => {
  const requestId = randomUUID();
  assert.equal(leadIdForRequest(requestId, 'production'), leadIdForRequest(requestId.toUpperCase(), 'production'));
  assert.notEqual(leadIdForRequest(requestId, 'production'), leadIdForRequest(requestId, 'preview-test'));
  assert.equal(leadIdForRequest('../bad', 'production'), '');
  assert.notEqual(leadNamespace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'one' }), leadNamespace({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'two' }));
});

test('repetições concorrentes guardam um só contacto e todos os índices antes de devolver', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const submission = { requestId: randomUUID(), lead: validLead() };
  const results = await Promise.all(Array.from({ length: 8 }, () => repo.saveSubmission(submission)));
  assert.equal(new Set(results.map((record) => record.id)).size, 1);
  assert.equal([...memory.records.keys()].filter((path) => path.includes('/records/')).length, 1);
  assert.equal([...memory.records.keys()].filter((path) => path.includes('/inbox/')).length, 1);
  assert.equal([...memory.records.keys()].filter((path) => path.includes('/outbox/')).length, 1);
  for (const call of memory.calls.filter((call) => call.method === 'get')) assert.equal(call.options.useCache, false);
});

test('uma reserva impede fotografias de pedidos concorrentes com dados diferentes', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const requestId = randomUUID();
  let attachments = 0;
  const attachPhotos = async () => { attachments += 1; return { batchId: 'a'.repeat(32), count: 1 }; };
  const results = await Promise.allSettled([
    repo.saveSubmission({ requestId, lead: validLead(), photoSession: { batchId: 'a'.repeat(32) }, attachPhotos }),
    repo.saveSubmission({ requestId, lead: { ...validLead(), observations: 'Pedido diferente' }, photoSession: { batchId: 'b'.repeat(32) }, attachPhotos })
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(results.find((item) => item.status === 'rejected').reason.status, 409);
  assert.equal(attachments, 1);
});

test('uma escrita parcial nunca deixa um contacto canónico sem índices e conserva o timestamp na repetição', async () => {
  const memory = memoryBlob();
  let clock = Date.now();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test', now: () => clock });
  const submission = { requestId: randomUUID(), lead: validLead() };
  memory.faults.put = (path) => path.includes('/outbox/');
  await assert.rejects(repo.saveSubmission(submission));
  assert.equal([...memory.records.keys()].filter((path) => path.includes('/records/')).length, 0);
  const originalIndex = [...memory.records.keys()].find((path) => path.includes('/inbox/'));
  clock += 60_000;
  memory.faults.put = null;
  const record = await repo.saveSubmission(submission);
  assert.equal(Date.parse(record.createdAt), clock - 60_000);
  assert.deepEqual([...memory.records.keys()].filter((path) => path.includes('/inbox/')), [originalIndex]);
  assert.equal((await repo.page()).items[0].id, record.id);
});

test('um trabalhador antigo não apaga a recuperação criada por uma repetição mais recente', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const record = await repo.saveSubmission({ requestId: randomUUID(), lead: validLead() });
  const oldClaim = await repo.ensureRecovery(record);
  await repo.ensureRecovery(record);
  await repo.settleOutbox(record, { onesignal: { status: 'accepted' }, slack: { status: 'unknown' }, whatsapp: { status: 'disabled' } }, oldClaim);
  assert.equal((await repo.page({ outbox: true })).items.length, 1);
});

test('cada canal só pode ser reclamado por um trabalhador de cada vez', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const record = await repo.saveSubmission({ requestId: randomUUID(), lead: validLead() });
  const claims = await Promise.all(Array.from({ length: 8 }, () => repo.claimDelivery(record.id, 'slack')));
  assert.equal(claims.filter(Boolean).length, 1);
  await repo.finishDelivery(claims.find(Boolean), { status: 'accepted' });
  assert.equal(await repo.claimDelivery(record.id, 'slack', { manual: true, allowUnknown: true }), null);
});

test('um envio Slack interrompido torna-se incerto; só a repetição explícita o pode reenviar', async () => {
  const memory = memoryBlob();
  let clock = Date.now();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test', now: () => clock });
  const record = await repo.saveSubmission({ requestId: randomUUID(), lead: validLead() });
  await repo.claimDelivery(record.id, 'slack');
  clock += 91_000;
  assert.equal(await repo.claimDelivery(record.id, 'slack'), null);
  assert.equal((await repo.notifications(record.id)).slack.status, 'unknown');
  assert.ok(await repo.claimDelivery(record.id, 'slack', { allowUnknown: true, manual: true }));
});

test('a recuperação mantém tentativas falhadas e pode ser recriada após configuração', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const record = await repo.saveSubmission({ requestId: randomUUID(), lead: validLead() });
  await repo.settleOutbox(record, { onesignal: { status: 'failed', retryable: true }, slack: { status: 'accepted' }, whatsapp: { status: 'disabled' } });
  assert.equal((await repo.page({ outbox: true })).items.length, 1);
  await repo.settleOutbox(record, { onesignal: { status: 'accepted' }, slack: { status: 'unknown' }, whatsapp: { status: 'disabled' } });
  assert.equal((await repo.page({ outbox: true })).items.length, 0);
  await repo.ensureRecovery(record);
  assert.equal((await repo.page({ outbox: true })).items.length, 1);
});

test('alterações administrativas usam ETags e não reabrem um pedido por repetição do cliente', async () => {
  const memory = memoryBlob();
  const repo = createLeadRepository({ storage: memory.storage, namespace: 'test' });
  const submission = { requestId: randomUUID(), lead: validLead() };
  const record = await repo.saveSubmission(submission);
  await repo.setStatus(record.id, 'closed');
  assert.equal((await repo.saveSubmission(submission)).status, 'closed');
  await assert.rejects(repo.setStatus(record.id, 'arbitrary'), { status: 400 });
});
