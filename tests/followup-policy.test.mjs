import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateFollowUp,
  getNextStage,
  isSunday
} from '../lib/followup-policy.js';

const baseLead = {
  status: 'open',
  canContact: true,
  sequenceStartedAt: '2026-08-03T09:00:00.000Z',
  lastInboundAt: null,
  followupsSent: [],
  vehicleStatus: 'available'
};

test('stage 1 becomes due after 24 hours', () => {
  const result = evaluateFollowUp(baseLead, '2026-08-04T09:01:00.000Z');
  assert.equal(result.eligible, true);
  assert.equal(result.stage, 1);
});

test('stage 2 is next after stage 1 was sent', () => {
  const lead = { ...baseLead, followupsSent: [{ stage: 1, sentAt: '2026-08-04T09:01:00.000Z' }] };
  const result = evaluateFollowUp(lead, '2026-08-06T09:01:00.000Z');
  assert.equal(result.eligible, true);
  assert.equal(result.stage, 2);
});

test('any newer customer reply stops the sequence', () => {
  const lead = { ...baseLead, lastInboundAt: '2026-08-04T10:00:00.000Z' };
  const result = evaluateFollowUp(lead, '2026-08-10T10:00:00.000Z');
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'customer_replied');
});

test('do not contact blocks every follow-up', () => {
  const result = evaluateFollowUp({ ...baseLead, doNotContact: true }, '2026-08-10T10:00:00.000Z');
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'do_not_contact');
});

test('sold vehicle blocks follow-up', () => {
  const result = evaluateFollowUp({ ...baseLead, vehicleStatus: 'sold' }, '2026-08-10T10:00:00.000Z');
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'vehicle_sold');
});

test('Sunday is paused in Europe/Lisbon', () => {
  assert.equal(isSunday('2026-08-09T10:00:00.000Z', 'Europe/Lisbon'), true);
  const result = evaluateFollowUp(baseLead, '2026-08-09T10:00:00.000Z');
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'sunday_pause');
});

test('sequence stops after all three stages', () => {
  const lead = { ...baseLead, followupsSent: [1, 2, 3] };
  assert.equal(getNextStage(lead), null);
  const result = evaluateFollowUp(lead, '2026-08-20T10:00:00.000Z');
  assert.equal(result.eligible, false);
  assert.equal(result.reason, 'sequence_complete');
});
