import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../vehicle-photos.js', import.meta.url), 'utf8');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
  }

  set id(value) {
    if (this._id) this.ownerDocument.elements.delete(this._id);
    this._id = value;
    if (value) this.ownerDocument.elements.set(value, this);
  }

  get id() {
    return this._id || '';
  }

  detach() {
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  appendChild(child) {
    child.detach();
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  insertBefore(child, reference) {
    child.detach();
    const index = this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, child);
    child.parentNode = this;
    return child;
  }

  remove() {
    this.detach();
    if (this._id) this.ownerDocument.elements.delete(this._id);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener() {}

  querySelector() {
    return null;
  }
}

function setupPhotoCard({ complete = true } = {}) {
  const domReadyListeners = [];
  const document = {
    elements: new Map(),
    addEventListener(name, listener) {
      if (name === 'DOMContentLoaded') domReadyListeners.push(listener);
    },
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return document.elements.get(id) || null;
    },
    querySelectorAll() {
      return [];
    }
  };
  document.head = new FakeElement('head', document);

  const messages = new FakeElement('div', document);
  messages.id = 'messages';
  const followup = new FakeElement('div', document);
  followup.id = 'followupActions';
  messages.appendChild(followup);

  const context = {
    document,
    state: {
      vehicle: { title: 'Fiat 500e' },
      lead: {
        viatura: 'Fiat 500e',
        retoma: 'Renault Clio Diesel, 2010, 234 000 km',
        matricula: '12-AB-34'
      }
    },
    AutoValorValidation: {
      validateTradeIn() {
        return { ok: complete };
      }
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      removeItem() {},
      setItem() {}
    },
    whatsappText() {
      return 'Pedido';
    },
    whatsappUrl() {
      return 'https://wa.me/351918404101';
    },
    renderSummary() {},
    selectVehicle() {},
    resetState() {},
    scrollEnd() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {},
    URLSearchParams,
    AbortController,
    Intl,
    console
  };

  vm.runInNewContext(source, context);
  assert.equal(domReadyListeners.length, 1);
  domReadyListeners[0]();

  return { document, followup, messages };
}

test('places the optional photo card before the final send actions', () => {
  const flow = setupPhotoCard();
  const card = flow.document.getElementById('photoUploadCard');

  assert.ok(card);
  assert.deepEqual(flow.messages.children, [card, flow.followup]);
});

test('does not offer photos while the trade-in details are incomplete', () => {
  const flow = setupPhotoCard({ complete: false });

  assert.equal(flow.document.getElementById('photoUploadCard'), null);
  assert.deepEqual(flow.messages.children, [flow.followup]);
});
