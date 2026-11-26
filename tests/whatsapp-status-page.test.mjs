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

async function page(initial, { request, navigator, hash = '' } = {}) {
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
    if (request) { const result = await request(new URL(endpoint, 'https://example.invalid').searchParams, options); if (result) return result; }
    return { ok: true, status: 200, json: async () => structuredClone(response) };
  };
  vm.runInNewContext(script, { document, fetch, File, URL, URLSearchParams, Date, AbortController, AbortSignal, navigator, location: { hash }, setTimeout, clearTimeout });
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

test('finding a video shows the next step for the actual device and makes only read requests', async () => {
  for (const [device, expected, canReserve] of [
    [null, /Acesso do dispositivo/, false],
    [{ valid: false, thisDevice: true }, /Acesso do dispositivo/, false],
    [{ valid: true, thisDevice: false }, /navegador autorizado|dispositivo autorizado/, false],
    [{ valid: true, thisDevice: true }, /Reserva este vídeo/, true]
  ]) {
    const app = await page({ role: 'admin', candidate: { title: 'Viatura de teste', price: '15000 €', id: 'IDabcde1' }, device, blocked: false });
    await app.get('plan').onclick();
    assert.match(app.get('candidateHint').textContent, expected);
    assert.equal(Boolean(app.get('claim').hidden), !canReserve);
    assert.match(app.get('message').textContent, /Pesquisa de vídeo concluída/);
    assert.ok(app.calls.every(call => call.options.method === 'GET'));
  }
});

test('mobile vehicle sharing verifies the account and reserves one send before a fresh user gesture; publication still requires observation', async () => {
  const initial = { ok: true, role: 'admin', device: { id: 'D1', valid: true, thisDevice: true }, blocked: true,
    active: { attemptId: 'A1', deviceId: 'D1', id: 'IDabcde1', title: 'Renault Zoe', price: '12990 EUR', phase: 'reserved' } };
  const actions = [], transfers = [];
  const app = await page(initial, { hash: '#viaturas-novas', request: async (params, options) => {
    const action = params.get('action'); actions.push(action);
    if (action === 'media') {
      assert.equal(params.get('attempt'), 'A1');
      return new Response(new Uint8Array(2048), { headers: { 'Content-Type': 'video/mp4' } });
    }
    if (action === 'begin') {
      assert.deepEqual(JSON.parse(options.body), { attemptId: 'A1', account: '+351965637736' });
      return Response.json({ ...initial, active: { ...initial.active, phase: 'publishing', publicationStartedAt: new Date().toISOString() } });
    }
  }, navigator: { canShare: ({ files }) => files[0].size === 2048, share: async ({ files }) => { transfers.push(files[0]); } } });
  assert.deepEqual(actions, ['plan']); assert.equal(app.get('nativePrepare').hidden, false);
  await app.get('nativePrepare').onclick(); assert.deepEqual(actions, ['plan']);
  app.get('account').value = '+351 965637736';
  await app.get('nativePrepare').onclick();
  assert.equal(app.get('nativeShare').hidden, false); assert.deepEqual(actions, ['plan','media','begin']); assert.equal(transfers.length, 0);
  await Promise.all([app.get('nativeShare').onclick(), app.get('nativeShare').onclick()]);
  assert.equal(transfers.length, 1); assert.equal(transfers[0].name, 'AutoValorPT_IDabcde1.mp4');
  assert.deepEqual(actions, ['plan','media','begin']); assert.equal(app.get('evidence').hidden, false);
  assert.match(app.get('message').textContent, /depois de veres o vídeo/);
});

test('opening the car shortcut with no stock response still loads the device controls and explains the failure', async () => {
  const actions = [];
  const app = await page({ ok: true, role: 'admin' }, { hash: '#viaturas-novas', request: params => {
    actions.push(params.get('action'));
    if (params.get('action') === 'plan') return Response.json({ error: 'status_source_unverified' }, { status: 409 });
  } });
  assert.deepEqual(actions, ['plan','status']); assert.equal(app.get('private').hidden, false);
  assert.match(app.get('message').textContent, /confirmar o stock atual/);
});
