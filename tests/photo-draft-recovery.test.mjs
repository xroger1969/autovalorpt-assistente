import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sources = ['validation-core.js', 'assistant-boot.js', 'send-readiness-fix.js', 'vehicle-photos.js']
  .map((name) => [name, readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')]);
const DRAFT_KEY = 'autovalorpt-assistente-draft-v2';
const PHOTO_KEY = 'autovalorpt-retoma-fotos-v2';
const SUBMISSION_KEY = 'autovalorpt-assistente-submission-v3';
const batchA = 'a'.repeat(32);
const batchB = 'b'.repeat(32);
const writerA = 'a'.repeat(43);
const writerB = 'b'.repeat(43);
const viewerA = 'v'.repeat(43);
const viewerB = 'w'.repeat(43);
const emptyLead = { nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', matricula: '', visita: '', observacoes: '' };
const savedLead = {
  ...emptyLead, nome: 'Maria Silva', telefone: '912345678', viatura: 'Fiat 500e',
  retoma: 'Renault Clio Diesel, 2010, 234 000 km', matricula: '12-AB-34', observacoes: 'Pretendo uma avaliação.'
};
const fingerprint = `${savedLead.viatura}|${savedLead.retoma}|${savedLead.matricula}`;
const success = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' });

function setup({ draft = true, photo = {}, notify, initialSaved, gallery } = {}) {
  const saved = new Map(initialSaved || []);
  if (!initialSaved && draft) {
    saved.set(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), vehicle: { title: 'Fiat 500e' }, lead: savedLead, selectedIntents: ['retoma'], finished: true }));
    saved.set(PHOTO_KEY, JSON.stringify({
      savedAt: Date.now(), fingerprint, batchId: batchA, viewerToken: viewerA, uploadToken: writerA,
      uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(), count: 2,
      galleryUrl: `/fotos.html?batch=${batchA}&token=${viewerA}`, ...photo
    }));
  }
  const elements = new Map();
  const listeners = new Map();
  const timers = new Map();
  const requests = [];
  let nextTimer = 0;
  let uploaded = 0;
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.value = ''; this.style = {}; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id || ''; }
    set textContent(value) { for (const child of [...this.children]) child.remove(); this._text = String(value); }
    get textContent() { return (this._text || '') + this.children.map((child) => child.textContent).join(''); }
    appendChild(child) { child.detach(); this.children.push(child); child.parentNode = this; return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    insertBefore(child, reference) { child.detach(); const at = this.children.indexOf(reference); this.children.splice(at < 0 ? this.children.length : at, 0, child); child.parentNode = this; return child; }
    detach() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
    remove() { for (const child of [...this.children]) child.remove(); this.detach(); if (this.id && elements.get(this.id) === this) elements.delete(this.id); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { const handlers = this.listeners.get(name) || []; handlers.push(callback); this.listeners.set(name, handlers); }
    fire(name) { for (const handler of this.listeners.get(name) || []) handler({ target: this, preventDefault() {} }); }
    click() { if (!this.disabled) this.fire('click'); }
    focus() { this.focused = true; }
    querySelector(selector) {
      const match = (element) => selector.startsWith('.') ? String(element.className || '').split(/\s+/).includes(selector.slice(1)) : element.tagName === selector;
      for (const child of this.children) { if (match(child)) return child; const nested = child.querySelector(selector); if (nested) return nested; }
      return null;
    }
  }
  const document = {
    createElement: (tag) => new Element(tag), getElementById: (id) => elements.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [], head: new Element('head'),
    addEventListener(name, callback, options) { const handlers = listeners.get(name) || []; handlers.push({ callback, once: options?.once }); listeners.set(name, handlers); },
    dispatchEvent(event) {
      for (const handler of [...(listeners.get(event.type) || [])]) {
        if (handler.once) listeners.set(event.type, listeners.get(event.type).filter((item) => item !== handler));
        handler.callback(event);
      }
      return true;
    }
  };
  for (const id of ['messages', 'summary', 'composer', 'chatTitle', 'changeBtn', 'resetBtn', 'startBtn']) { const element = document.createElement('div'); element.id = id; }
  const state = { lead: { ...emptyLead }, vehicle: null, stockRequest: 0, selectedIntents: [], intentQueue: [], pendingIntent: '', finished: false };
  const context = {
    document, state, EMPTY_LEAD: emptyLead, ACTIONS: [['retoma', '', 'Retoma']], INTENTS: {},
    crypto: webcrypto, Uint8Array, AbortController, URLSearchParams, Blob, console,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    URL: { createObjectURL: () => 'blob:test-photo', revokeObjectURL() {} },
    Image: class { set src(_) { this.onerror(); } },
    sessionStorage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
    setTimeout(callback, delay = 0) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, addEventListener() {},
    el(tag, className, text) { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element; },
    renderSummary() {}, renderSelected() {}, scrollEnd() {}, renderPurposeActions() {}, setComposer() {}, addBubble() {},
    async sendMessage() {}, beginSelectedIntents() {}, selectVehicle() {}, changeVehicle() {},
    resetState() { state.vehicle = null; state.lead = { ...emptyLead }; state.finished = false; },
    finishFlow() { state.finished = true; context.renderSummary(); context.AutoValorLead?.renderReview(); },
    whatsappText: () => 'Pedido', whatsappUrl: () => '#',
    fetch: async (url, options = {}) => {
      const request = { url, method: options.method || 'GET', payload: typeof options.body === 'string' ? JSON.parse(options.body) : null };
      requests.push(request);
      if (url.startsWith('/api/photo-gallery?')) {
        if (gallery) return gallery(url, request, requests);
        const batch = new URL(url, 'https://example.test').searchParams.get('batch');
        const count = batch === batchA ? photo.count ?? 2 : uploaded;
        return success({ photos: Array.from({ length: count }, (_, i) => ({ url: `/mock-photo/${batch}/${i}` })), uploadsClosed: Boolean(photo.submitting || photo.submitted) && batch === batchA });
      }
      if (url === '/api/photo-session') return success({ batchId: batchB, uploadToken: writerB, viewerToken: viewerB, uploadExpiresAt: new Date(Date.now() + 60_000).toISOString(), galleryUrl: `/fotos.html?batch=${batchB}&token=${viewerB}` });
      if (url === '/api/photo-upload-url') return success({ uploadUrl: 'https://uploads.example.test/photo' });
      if (url === 'https://uploads.example.test/photo') { uploaded += 1; return success({}); }
      if (url === '/api/notify-lead') return notify ? notify(request, requests.filter((item) => item.url === url).length) : success({ ok: true, persisted: true, leadId: 'c'.repeat(32), receipt: 'CV-TEST' });
      throw new Error(`Unexpected mock request: ${url}`);
    }
  };
  context.window = context;
  document.getElementById('startBtn').addEventListener('click', () => context.resetState());
  vm.createContext(context);
  for (const [filename, source] of sources) vm.runInContext(source, context, { filename });
  document.dispatchEvent({ type: 'DOMContentLoaded' });
  function flushTimers() {
    for (let turn = 0; turn < 100; turn++) {
      const next = [...timers].find(([, value]) => value.delay === 0);
      if (!next) return;
      timers.delete(next[0]); next[1].callback();
    }
    throw new Error('Unbounded zero-delay timer loop');
  }
  async function settle() { for (let i = 0; i < 3; i++) { flushTimers(); await new Promise(setImmediate); } }
  async function choosePhoto() {
    const input = document.getElementById('photoUploadCard').querySelector('input');
    input.files = [Object.assign(new Blob(['fake-photo'], { type: 'image/jpeg' }), { name: 'car.jpg' })];
    input.fire('change');
    await settle();
  }
  return { context, document, state, saved, requests, settle, choosePhoto, photos: context.AutoValorPhotos, lead: context.AutoValorLead };
}

test('photo restoration waits for the actual deferred assistant draft and retains the attachment in the next submission', async () => {
  const flow = setup();
  assert.equal(flow.state.vehicle, null);
  assert.equal(flow.context.AutoValorDraft.ready, false);
  assert.equal(flow.photos.readyForSubmit(), false);
  assert.equal(flow.photos.freezeForSubmit(), false);
  assert.equal(flow.requests.length, 0);
  await flow.settle();
  assert.equal(flow.context.AutoValorDraft.ready, true);
  assert.equal(flow.photos.readyForSubmit(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(flow.photos.getLeadAttachment())), { batchId: batchA, viewerToken: viewerA, uploadToken: writerA, count: 2 });
  assert.match(flow.document.getElementById('reviewPhotoStatus').textContent, /2 fotografias/);
  await flow.lead.submit();
  const sent = flow.requests.find((request) => request.url === '/api/notify-lead').payload;
  assert.equal(sent.photoSession.batchId, batchA);
  assert.equal(sent.photoSession.uploadToken, writerA);
  assert.equal(sent.photoSession.count, 2);
  assert.equal(flow.lead.isSubmitted(), true);
});

test('an empty bootstrap completes photo initialization even when its ready event occurred first', async () => {
  const flow = setup({ draft: false });
  await flow.settle();
  assert.equal(flow.context.AutoValorDraft.ready, true);
  assert.equal(flow.photos.readyForSubmit(), true);
  assert.equal(flow.photos.getLeadAttachment(), null);
  assert.equal(flow.requests.length, 0);
});

test('expired sessions at the ten-photo limit allow a fresh selection and use a new writer and batch', async () => {
  const flow = setup({ photo: { count: 10, uploadExpiresAt: new Date(Date.now() - 1_000).toISOString() } });
  await flow.settle();
  const choose = flow.document.getElementById('photoUploadCard').querySelector('.photo-upload-primary');
  assert.equal(choose.disabled, false);
  assert.equal(choose.textContent, 'Voltar a escolher fotografias');
  await flow.choosePhoto();
  const upload = flow.requests.find((request) => request.url === '/api/photo-upload-url');
  assert.equal(upload.payload.batchId, batchB);
  assert.equal(upload.payload.uploadToken, writerB);
  assert.equal(upload.payload.index, 1);
  assert.equal(flow.photos.getLeadAttachment().count, 1);
  assert.equal(flow.state.lead.nome, savedLead.nome);
  assert.equal(flow.state.lead.retoma, savedLead.retoma);
});

test('a definitive expired-session 422 unlocks only that attachment and the next reviewed send uses a new request ID', async () => {
  const flow = setup({ notify: (_request, count) => count === 1
    ? success({ ok: false, persisted: false, error: 'photo_session_expired' }, 422)
    : success({ ok: true, persisted: true, leadId: 'c'.repeat(32), receipt: 'CV-TEST' }) });
  await flow.settle();
  await flow.lead.submit();
  const first = flow.requests.find((request) => request.url === '/api/notify-lead').payload;
  assert.equal(flow.lead.requestId, '');
  assert.equal(flow.photos.getLeadAttachment(), null);
  assert.equal(flow.saved.has(SUBMISSION_KEY), false);
  assert.equal(flow.document.getElementById('reviewFields').disabled, false);
  assert.match(flow.document.getElementById('reviewStatus').textContent, /Selecione novamente as fotografias/);
  assert.equal(flow.state.lead.nome, savedLead.nome);
  assert.equal(flow.state.lead.retoma, savedLead.retoma);
  await flow.choosePhoto();
  await flow.lead.submit();
  const sent = flow.requests.filter((request) => request.url === '/api/notify-lead');
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].payload.requestId, first.requestId);
  assert.deepEqual(sent[1].payload.lead, first.lead);
  assert.equal(sent[1].payload.photoSession.batchId, batchB);
  assert.equal(sent[1].payload.photoSession.uploadToken, writerB);
  assert.equal(sent[1].payload.photoSession.count, 1);
  assert.equal(flow.lead.isSubmitted(), true);
});

test('an explicit expired-session rejection also allows the customer to confirm the same lead without photos', async () => {
  const flow = setup({ notify: (_request, count) => count === 1
    ? success({ ok: false, persisted: false, error: 'photo_session_expired' }, 422)
    : success({ ok: true, persisted: true, leadId: 'c'.repeat(32) }) });
  await flow.settle();
  await flow.lead.submit();
  assert.equal(flow.requests.filter((request) => request.url === '/api/notify-lead').length, 1);
  await flow.lead.submit();
  const sent = flow.requests.filter((request) => request.url === '/api/notify-lead');
  assert.equal(sent[1].payload.photoSession, null);
  assert.deepEqual(sent[1].payload.lead, sent[0].payload.lead);
  assert.match(flow.document.getElementById('photoUploadCard').textContent, /Pedido enviado sem fotografias/);
});

test('ambiguous failure and reload preserve the complete frozen request even after its upload token expires', async () => {
  const flow = setup({ notify: async () => { throw new Error('network'); } });
  await flow.settle();
  await flow.lead.submit();
  const first = flow.requests.find((request) => request.url === '/api/notify-lead').payload;
  const pendingPhotos = JSON.parse(flow.saved.get(PHOTO_KEY));
  assert.equal(pendingPhotos.submitting, true);
  pendingPhotos.uploadExpiresAt = new Date(Date.now() - 1_000).toISOString();
  flow.saved.set(PHOTO_KEY, JSON.stringify(pendingPhotos));
  const reload = setup({ initialSaved: flow.saved, photo: { submitting: true } });
  await reload.settle();
  assert.equal(reload.document.getElementById('reviewFields').disabled, true);
  assert.equal(reload.document.getElementById('photoUploadCard').querySelector('.photo-upload-primary').disabled, true);
  await reload.choosePhoto();
  assert.equal(reload.requests.some((request) => request.url === '/api/photo-session'), false);
  await reload.lead.submit();
  const retried = reload.requests.find((request) => request.url === '/api/notify-lead').payload;
  assert.deepEqual(retried, first);
  assert.equal(reload.lead.isSubmitted(), true);
});

test('a confirmed attachment survives reload and cannot be cleared by an expired-session recovery call', async () => {
  const flow = setup();
  await flow.settle();
  await flow.lead.submit();
  const confirmed = JSON.parse(flow.saved.get(PHOTO_KEY));
  assert.equal(confirmed.uploadToken, '');
  assert.equal(confirmed.submitted, true);
  const reload = setup({ initialSaved: flow.saved, photo: { submitted: true } });
  await reload.settle();
  assert.equal(reload.photos.resumeEditing('photo_session_expired'), false);
  const restored = JSON.parse(reload.saved.get(PHOTO_KEY));
  assert.equal(restored.batchId, batchA);
  assert.equal(restored.count, 2);
  assert.equal(restored.submitted, true);
  assert.equal(restored.leadId, 'c'.repeat(32));
  assert.match(reload.document.getElementById('photoUploadCard').textContent, /2 fotografias associadas ao seu pedido/);
  assert.equal(reload.document.getElementById('photoUploadCard').querySelector('.photo-upload-primary').disabled, true);
});

test('a non-session validation rejection preserves an otherwise valid attachment', async () => {
  const flow = setup({ notify: () => success({ ok: false, persisted: false, error: 'photos_not_ready' }, 422) });
  await flow.settle();
  await flow.lead.submit();
  assert.equal(flow.photos.getLeadAttachment().batchId, batchA);
  assert.equal(flow.photos.getLeadAttachment().uploadToken, writerA);
  assert.equal(flow.photos.getLeadAttachment().count, 2);
  assert.equal(flow.document.getElementById('reviewFields').disabled, false);
});

test('a late gallery response cannot restore a rejected batch or block its replacement', async () => {
  let finishGallery;
  const flow = setup({
    gallery: () => new Promise((resolve) => { finishGallery = resolve; }),
    notify: () => success({ ok: false, persisted: false, error: 'invalid_photo_session' }, 422)
  });
  await flow.settle();
  assert.equal(typeof finishGallery, 'function');
  await flow.lead.submit();
  assert.equal(flow.photos.getLeadAttachment(), null);
  finishGallery(success({ photos: [{ url: '/old-photo/1' }, { url: '/old-photo/2' }], uploadsClosed: true }));
  await flow.settle();
  const restored = JSON.parse(flow.saved.get(PHOTO_KEY));
  assert.equal(restored.batchId, '');
  assert.equal(restored.count, 0);
  assert.equal(restored.submitting, false);
  assert.equal(flow.document.getElementById('photoUploadCard').querySelector('.photo-upload-primary').disabled, false);
});
