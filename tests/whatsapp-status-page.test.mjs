import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../estado-whatsapp.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../estado-whatsapp.js', import.meta.url), 'utf8');
const textFields = ['withdrawalAccount', 'withdrawalBeforeObservation', 'withdrawalAfterObservation'];
const checks = ['withdrawalVisible', 'withdrawalUnambiguous', 'withdrawalActionObserved', 'withdrawalAbsent'];

function withdrawal(attemptId, phase = 'reserved') {
  return { ok: true, role: 'device', automation: 'publication_observed_scheduled_test_pending', blocked: true,
    device: { id: 'device-one', valid: true, thisDevice: true, expiresAt: '2027-02-12T08:00:00Z' },
    active: { kind: 'withdrawal', attemptId, deviceId: 'device-one', phase, id: `IDabcde${attemptId}`,
      fingerprint: 'a'.repeat(64), publicationAttemptId: `publication-${attemptId}`, title: `Carro ${attemptId}`, price: '12500 EUR',
      reason: 'out_of_stock', publicationObservation: `O carro ${attemptId} e o preço ficaram visíveis.`,
      observedAt: '2026-11-14T08:15:00Z', startedAt: '2026-11-14T09:00:00Z',
      ...(phase === 'deleting' ? { deletionStartedAt: '2026-11-14T09:02:00Z' } : {}) },
    lastResult: null, lastWithdrawalResult: null };
}

async function page(initial) {
  const elements = new Map(); const created = []; const calls = []; let response = initial;
  function element(tagName) {
    return { tagName: tagName.toUpperCase(), textContent: '', hidden: false, disabled: false, value: '', checked: false,
      children: [], attributes: new Map(),
      replaceChildren(...nodes) { this.children = [...nodes]; }, append(...nodes) { this.children.push(...nodes); },
      removeAttribute(name) { this.attributes.delete(name); delete this[name]; } };
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*(["'])([^"']+)\2[^>]*>/gi)) {
    elements.set(match[3], element(match[1]));
  }
  const document = {
    getElementById: id => elements.get(id) || null,
    createElement: tag => { const node = element(tag); created.push(node); return node; },
    querySelectorAll: selector => {
      assert.equal(selector, 'button');
      return [...elements.values(), ...created].filter(node => node.tagName === 'BUTTON');
    },
  };
  const fetch = async (endpoint, options = {}) => {
    calls.push({ endpoint, options });
    return { ok: true, status: 200, json: async () => structuredClone(response) };
  };
  vm.runInNewContext(script, { document, fetch, URLSearchParams, Date, AbortController, setTimeout, clearTimeout });
  await new Promise(resolve => setImmediate(resolve));
  return { get: id => document.getElementById(id), calls,
    async refresh(value) { response = value; await elements.get('refresh').onclick(); } };
}

function fillProof(app) {
  app.get('withdrawalAccount').value = '+351965637736';
  app.get('withdrawalBeforeObservation').value = 'Identifiquei o carro anterior pelo preço e pela imagem.';
  app.get('withdrawalAfterObservation').value = 'Observei a eliminação do carro anterior e a sua ausência.';
  for (const id of checks) app.get(id).checked = true;
}

test('every literal WhatsApp page element reference has exactly one matching HTML element', () => {
  const ids = [...html.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/g)].map(match => match[2]);
  const refs = [...script.matchAll(/\$\(\s*(["'])([^"']+)\1\s*\)/g)].map(match => match[2]);
  assert.ok(refs.length > 30, 'The check must inspect the actual page controls.');
  for (const id of new Set(refs)) assert.equal(ids.filter(value => value === id).length, 1, `Missing or duplicated HTML id: ${id}`);
});

test('switching withdrawal attempt clears all prior visual evidence and account without submitting a mutation', async () => {
  const app = await page(withdrawal('A'));
  assert.equal(app.get('withdrawalAttempt').hidden, false);
  fillProof(app);
  await app.refresh(withdrawal('B'));
  for (const id of textFields) assert.equal(app.get(id).value, '', `Stale text carried into the new attempt: ${id}`);
  for (const id of checks) assert.equal(app.get(id).checked, false, `Stale observation carried into the new attempt: ${id}`);
  assert.ok(app.get('withdrawalDetails').children.some(child => String(child.textContent).includes('Carro B')));
  assert.equal(app.calls.length, 2);
  for (const call of app.calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(new URL(call.endpoint, 'https://example.invalid').searchParams.get('action'), 'status');
    assert.equal(call.options.body, undefined);
  }
});

test('refreshing the same withdrawal attempt preserves entered evidence across its phase transition', async () => {
  const app = await page(withdrawal('A'));
  fillProof(app);
  const expected = Object.fromEntries(textFields.map(id => [id, app.get(id).value]));
  await app.refresh(withdrawal('A', 'deleting'));
  for (const id of textFields) assert.equal(app.get(id).value, expected[id]);
  for (const id of checks) assert.equal(app.get(id).checked, true);
  assert.equal(app.get('withdrawalBefore').hidden, true);
  assert.equal(app.get('withdrawalAfter').hidden, false);
  assert.ok(app.calls.every(call => call.options.method === 'GET'));
});
