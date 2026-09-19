import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFollowUpLeadId,
  mergeFollowUpLeadRecords,
  normalizeFollowUpLead,
  normalizeLeadPhone
} from '../lib/followup-registry.js';
import {
  buildFollowUpMessage,
  maskPhone,
  scanFollowUps
} from '../lib/followup-dry-run.js';

test('normalizes Portuguese mobile numbers without exposing formatting differences', () => {
  assert.equal(normalizeLeadPhone('+351 918 404 101'), '351918404101');
  assert.equal(normalizeLeadPhone('918 404 101'), '351918404101');
  assert.equal(normalizeLeadPhone('00351 918404101'), '351918404101');
});

test('creates a stable opaque lead id from phone and vehicle', () => {
  const a = createFollowUpLeadId({ phone: '+351 918 404 101', vehicle: 'Audi Q4 e-tron' });
  const b = createFollowUpLeadId({ phone: '918404101', vehicle: 'Audi Q4 e-tron' });
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(a, b);
});

test('normalizes a lead into a safe follow-up record', () => {
  const lead = normalizeFollowUpLead({
    name: 'Ana Rita',
    phone: '+351 935 052 792',
    vehicle: 'Audi Q4',
    observations: '<script> teste </script>'
  }, '2026-08-04T08:00:00.000Z');

  assert.equal(lead.name, 'Ana Rita');
  assert.equal(lead.phone, '351935052792');
  assert.equal(lead.sequenceStartedAt, '2026-08-04T08:00:00.000Z');
  assert.equal(lead.status, 'open');
  assert.equal(lead.observations.includes('<'), false);
});

test('merging a repeated notification does not reopen a closed lead or reset sent stages', () => {
  const original = normalizeFollowUpLead({
    name: 'Cliente',
    phone: '935052792',
    vehicle: 'Audi Q4',
    status: 'closed',
    followupsSent: [{ stage: 1, sentAt: '2026-08-05T08:00:00Z' }]
  }, '2026-08-04T08:00:00Z');
  const repeated = normalizeFollowUpLead({
    name: 'Cliente',
    phone: '+351935052792',
    vehicle: 'Audi Q4',
    status: 'open'
  }, '2026-08-06T08:00:00Z');

  const merged = mergeFollowUpLeadRecords(original, repeated, '2026-08-06T08:00:00Z');
  assert.equal(merged.status, 'closed');
  assert.deepEqual(merged.followupsSent, original.followupsSent);
  assert.equal(merged.sequenceStartedAt, original.sequenceStartedAt);
});

test('dry-run identifies a due first follow-up but never enables sending', () => {
  const lead = normalizeFollowUpLead({
    name: 'Ana Rita',
    phone: '935052792',
    vehicle: 'Audi Q4',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');
  const report = scanFollowUps([lead], '2026-08-04T08:01:00Z');

  assert.equal(report.mode, 'dry-run');
  assert.equal(report.sendEnabled, false);
  assert.equal(report.dueCount, 1);
  assert.equal(report.due[0].stage, 1);
  assert.match(report.due[0].message, /Ana Rita/);
  assert.match(report.due[0].message, /Audi Q4/);
});

test('dry-run stops a lead after a customer reply', () => {
  const lead = normalizeFollowUpLead({
    name: 'Cliente',
    phone: '933664414',
    vehicle: 'Tesla Model 3',
    sequenceStartedAt: '2026-08-03T08:00:00Z',
    lastInboundAt: '2026-08-03T12:00:00Z'
  }, '2026-08-03T08:00:00Z');
  const report = scanFollowUps([lead], '2026-08-10T08:00:00Z');

  assert.equal(report.dueCount, 0);
  assert.equal(report.blocked.customer_replied, 1);
});

test('dry-run pauses due messages on Sunday in Lisbon', () => {
  const lead = normalizeFollowUpLead({
    name: 'Cliente',
    phone: '915226768',
    vehicle: 'BMW i4',
    sequenceStartedAt: '2026-08-03T08:00:00Z'
  }, '2026-08-03T08:00:00Z');
  const report = scanFollowUps([lead], '2026-08-09T10:00:00Z');

  assert.equal(report.dueCount, 0);
  assert.equal(report.blocked.sunday_pause, 1);
});

test('phone is masked in dry-run reports', () => {
  assert.equal(maskPhone('351935052792'), '********2792');
  assert.equal(buildFollowUpMessage(3, { name: 'João', vehicle: 'Audi Q4' }).includes('último contacto'), true);
});
