import test from 'node:test';
import assert from 'node:assert/strict';

import { scanFollowUps } from '../lib/followup-dry-run.js';
import { normalizeFollowUpLead } from '../lib/followup-registry.js';
import { applyFollowUpState, followUpStateLabel } from '../lib/followup-status.js';

test('fictitious lead becomes due after 24h in dry-run only', () => {
  const lead = normalizeFollowUpLead({
    name: 'Cliente Teste',
    phone: '910000000',
    vehicle: 'Audi Q4 Teste',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');

  const report = scanFollowUps([lead], '2026-08-04T08:01:00Z');
  assert.equal(report.sendEnabled, false);
  assert.equal(report.dueCount, 1);
  assert.equal(report.due[0].stage, 1);
  assert.equal(report.due[0].phoneMasked.endsWith('0000'), true);
});

test('Respondeu stops the fictitious lead immediately', () => {
  const base = normalizeFollowUpLead({
    name: 'Cliente Teste',
    phone: '910000000',
    vehicle: 'Audi Q4 Teste',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');
  const replied = applyFollowUpState(base, 'replied', '2026-08-04T09:00:00Z');
  const report = scanFollowUps([replied], '2026-08-10T09:00:00Z');

  assert.equal(followUpStateLabel('replied'), 'Respondeu');
  assert.equal(report.dueCount, 0);
  assert.equal(report.blocked.customer_replied, 1);
});

test('Negociação pauses automatic follow-up', () => {
  const base = normalizeFollowUpLead({
    name: 'Cliente Teste',
    phone: '910000000',
    vehicle: 'Audi Q4 Teste',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');
  const negotiation = applyFollowUpState(base, 'negotiation', '2026-08-04T09:00:00Z');
  const report = scanFollowUps([negotiation], '2026-08-10T09:00:00Z');

  assert.equal(report.dueCount, 0);
  assert.equal(report.blocked.in_negotiation, 1);
});

test('Aguardar explicitly restarts a fresh sequence', () => {
  const base = normalizeFollowUpLead({
    name: 'Cliente Teste',
    phone: '910000000',
    vehicle: 'Audi Q4 Teste',
    sequenceStartedAt: '2026-08-03T08:00:00Z',
    lastInboundAt: '2026-08-04T09:00:00Z',
    followupsSent: [{ stage: 1, sentAt: '2026-08-04T08:01:00Z' }]
  }, '2026-08-03T08:00:00Z');
  const waiting = applyFollowUpState(base, 'waiting', '2026-08-05T10:00:00Z');
  const beforeDue = scanFollowUps([waiting], '2026-08-06T09:59:00Z');
  const afterDue = scanFollowUps([waiting], '2026-08-06T10:01:00Z');

  assert.equal(waiting.lastInboundAt, null);
  assert.deepEqual(waiting.followupsSent, []);
  assert.equal(beforeDue.dueCount, 0);
  assert.equal(afterDue.dueCount, 1);
  assert.equal(afterDue.due[0].stage, 1);
});

test('Fechado and Não contactar permanently block the sequence', () => {
  const base = normalizeFollowUpLead({
    name: 'Cliente Teste',
    phone: '910000000',
    vehicle: 'Audi Q4 Teste',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');

  const closed = applyFollowUpState(base, 'closed', '2026-08-04T09:00:00Z');
  const noContact = applyFollowUpState(base, 'do_not_contact', '2026-08-04T09:00:00Z');

  const closedReport = scanFollowUps([closed], '2026-08-10T09:00:00Z');
  const noContactReport = scanFollowUps([noContact], '2026-08-10T09:00:00Z');

  assert.equal(closedReport.dueCount, 0);
  assert.equal(closedReport.blocked.closed_status, 1);
  assert.equal(noContactReport.dueCount, 0);
  assert.equal(noContactReport.blocked.do_not_contact, 1);
  assert.equal(noContact.canContact, false);
});
