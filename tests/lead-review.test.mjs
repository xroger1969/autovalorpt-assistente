import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const validation = readFileSync(new URL('../validation-core.js', import.meta.url), 'utf8');
const review = readFileSync(new URL('../send-readiness-fix.js', import.meta.url), 'utf8');

function setup({ fetchImpl, photos, initialSaved } = {}) {
  const elements = new Map();
  const domReady = [];
  const requests = [];
  const saved = new Map(initialSaved || []);
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.value = ''; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    remove() { for (const child of [...this.children]) child.remove(); if (this.id) elements.delete(this.id); if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    focus() { this.focused = true; }
  }
  const document = {
    createElement: (tag) => new Element(tag),
    getElementById: (id) => elements.get(id) || null,
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') domReady.push(callback); },
    head: new Element('head')
  };
  for (const id of ['composer', 'messages', 'chatTitle']) { const element = document.createElement('div'); element.id = id; }
  const state = { finished: true, vehicle: { title: 'Pedido geral', general: true }, selectedIntents: [], lead: { nome: 'Maria Silva', telefone: '912345678', viatura: '', financiamento: '', retoma: '', matricula: '', visita: '', observacoes: 'Pedido de informação: Tem viaturas automáticas?' } };
  const context = {
    document, state, ACTIONS: [], INTENTS: {}, crypto: webcrypto, Uint8Array, AbortController, setTimeout, clearTimeout,
    sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
    window: { AutoValorPhotos: photos, addEventListener() {} },
    el(tag, className, text) { const e = document.createElement(tag); e.className = className || ''; if (text !== undefined) e.textContent = text; return e; },
    renderSummary() {}, scrollEnd() {}, renderPurposeActions() {}, changeVehicle() {}, selectVehicle() {}, resetState() {},
    fetch: async (url, options) => { requests.push({ url, payload: JSON.parse(options.body) }); return fetchImpl ? fetchImpl(url, options, requests.length) : { ok: true, status: 200, json: async () => ({ ok: true, persisted: true, leadId: 'lead-test', receipt: 'CV-TEST' }) }; }
  };
  vm.runInNewContext(validation, context);
  vm.runInNewContext(review, context);
  domReady[0]();
  return { api: context.window.AutoValorLead, state, elements, requests, saved };
}

test('review does not submit automatically, and a free question without a selected car can be explicitly saved', async () => {
  const flow = setup();
  assert.equal(flow.requests.length, 0);
  assert.equal(flow.elements.get('review-viatura').value, '');
  await flow.api.submit();
  assert.equal(flow.requests.length, 1);
  assert.equal(flow.requests[0].payload.lead.vehicle, '');
  assert.equal(flow.requests[0].payload.lead.subjects, 'Pedido de informação');
  assert.equal(flow.api.isSubmitted(), true);
  assert.equal(flow.elements.get('chatTitle').textContent, 'Pedido recebido');
});

test('the customer can edit the review, and a ten-digit phone is rejected without any request', async () => {
  const flow = setup();
  const phone = flow.elements.get('review-telefone');
  phone.value = '9123456789';
  phone.listeners.get('input')();
  await flow.api.submit();
  assert.equal(flow.requests.length, 0);
  assert.equal(phone.focused, true);
  assert.match(flow.elements.get('reviewStatus').textContent, /9 algarismos/);
  phone.value = '+351 913 234 567';
  phone.listeners.get('input')();
  await flow.api.submit();
  assert.equal(flow.requests[0].payload.lead.phone, '913234567');
});

test('a lost response retries the identical payload and ID, including after a page reload', async () => {
  const flow = setup({ fetchImpl: async () => { throw new Error('network'); } });
  await flow.api.submit();
  const first = flow.requests[0].payload;
  assert.equal(flow.api.isSubmitted(), false);
  assert.equal(flow.elements.get('reviewFields').disabled, true);
  const reload = setup({ initialSaved: flow.saved });
  await reload.api.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(reload.requests[0].payload)), JSON.parse(JSON.stringify(first)));
  assert.equal(reload.api.isSubmitted(), true);
});

test('a notification-only success is never shown as a saved request', async () => {
  const flow = setup({ fetchImpl: async () => ({ok: true, status: 200, json: async () => ({ok: true, onesignal: true})}) });
  await flow.api.submit();
  assert.equal(flow.api.isSubmitted(), false);
  assert.match(flow.elements.get('reviewStatus').textContent, /Não conseguimos confirmar/);
});

test('double submit is prevented while the first request is pending', async () => {
  let finish;
  const flow = setup({fetchImpl: () => new Promise((resolve) => { finish = resolve; })});
  const first = flow.api.submit();
  await flow.api.submit();
  assert.equal(flow.requests.length, 1);
  finish({ok: true, status: 200, json: async () => ({ok:true,persisted:true,leadId:'lead-test'})});
  await first;
  await flow.api.submit();
  assert.equal(flow.requests.length, 1);
});

test('submission waits for photos, includes the attachment and clears the writer token on receipt', async () => {
  let ready = false;
  let submitted = '';
  const photos = {
    readyForSubmit: () => ready,
    freezeForSubmit: () => true,
    getLeadAttachment: () => ({batchId:'batch-test', uploadToken:'writer-secret-test', viewerToken:'viewer-secret-test', count:2}),
    markSubmitted: (id) => { submitted = id; }
  };
  const flow = setup({photos});
  await flow.api.submit();
  assert.equal(flow.requests.length, 0);
  ready = true;
  await flow.api.submit();
  assert.equal(flow.requests[0].payload.photoSession.count, 2);
  assert.equal(flow.requests[0].payload.photoSession.uploadToken, 'writer-secret-test');
  assert.equal(submitted, 'lead-test');
  assert.equal([...flow.saved.values()].some((value) => value.includes('writer-secret-test')), false);
});
