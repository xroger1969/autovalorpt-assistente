import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../leads.js', import.meta.url), 'utf8');
const redirect = readFileSync(new URL('../aviso-lead.js', import.meta.url), 'utf8');
const id = 'a'.repeat(32);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({authenticated = true, record = {}, search = ''} = {}) {
  const byId = new Map();
  const requests = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.value = ''; this._text = ''; this.className = ''; this.classList = {add: (name) => {this.className += ` ${name}`;}}; }
    set id(value) { this._id = value; byId.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
    get childElementCount() { return this.children.length; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach((child) => this.appendChild(child)); }
    replaceChildren(...children) { for (const child of this.children) { if (child.id) byId.delete(child.id); child.replaceChildren(); } this._text = ''; this.children = []; this.append(...children); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    querySelectorAll(tag) { return this.children.flatMap((child) => [...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
    dispatchEvent(event) { return this.listeners.get(event.type)?.(event); }
    scrollIntoView() {}
  }
  const document = { getElementById: (key) => byId.get(key) || null, createElement: (tag) => new Element(tag), createTextNode: (text) => {const el = new Element('#text');el.textContent = text;return el;} };
  for (const key of ['leadList','detailPanel','configurationNotice','dashboardView','privateNav','loginView','loginButton','loginStatus','accessCode','searchInput','statusFilter','newCount','contactedCount','closedCount','listMeta','loadMoreButton','refreshButton','dashboardStatus','loginForm','logoutButton']) {const e = document.createElement('div');e.id = key;}
  byId.get('statusFilter').value = 'all';
  const location = {search};
  const lead = {id,name:'Maria Silva',phone:'912345678',vehicle:'Viatura de teste',subjects:'Informação',status:'new',createdAt:'2026-10-23T10:00:00Z',receipt:'CV-TEST',notifications:{onesignal:{status:'accepted'},slack:{status:'unknown'},whatsapp:{status:'unconfigured'}},...record};
  const config = {outboundEnabled:true,onesignal:{configured:true},slack:{configured:true},whatsapp:{configured:false,missing:['WHATSAPP_ACCESS_TOKEN']}};
  const context = {
    document,location,history:{replaceState(_a,_b,value){location.search = value.includes('?') ? value.slice(value.indexOf('?')) : ''; }},
    window:{innerWidth:1200,addEventListener(){}},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Event,
    fetch:async (url, options) => {
      requests.push({url,method:options.method || 'GET',body:options.body ? JSON.parse(options.body) : null});
      let data;
      if (url === '/api/admin-session') data = {configured:true,authenticated};
      else if (url.includes('action=list')) data = {ok:true,items:[lead],cursor:null,configuration:config};
      else if (url.includes('action=get')) data = {ok:true,lead};
      else data = {ok:true};
      return {ok:true,status:200,json:async()=>data};
    }
  };
  vm.runInNewContext(source, context);
  return {byId,requests,location,lead};
}

test('an unauthenticated inbox does not fetch private records and removes legacy personal URL fields', async () => {
  const flow = setup({authenticated:false,search:'?nome=Maria&telefone=912345678'});
  await flush();
  assert.deepEqual(flow.requests.map((request) => request.url), ['/api/admin-session']);
  assert.equal(flow.location.search, '');
  assert.equal(flow.byId.get('dashboardView').hidden, true);
});

test('inbox displays private data as text, rejects unsafe links and never retries an alert on load', async () => {
  const flow = setup({search:`?lead=${id}&telefone=912345678`,record:{name:'<img src=x onerror=alert(1)>',vehicleUrl:'javascript:alert(1)'}});
  await flush(); await flush();
  assert.equal(flow.location.search, `?lead=${id}`);
  assert.equal(flow.requests.some((request) => request.method === 'POST'), false);
  assert.match(flow.byId.get('detailPanel').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(flow.byId.get('detailPanel').querySelectorAll('a').some((link) => link.href.startsWith('javascript:')), false);
  assert.match(flow.byId.get('detailPanel').textContent, /Aceite pelo serviço/);
  assert.match(flow.byId.get('detailPanel').textContent, /Sem confirmação/);
});

test('retrying an unconfirmed notification requires the explicit verification checkbox', async () => {
  const flow = setup({search:`?lead=${id}`});
  await flush(); await flush();
  const button = flow.byId.get('detailPanel').querySelectorAll('button').find((item) => item.textContent === 'Repetir os avisos sem confirmação');
  assert.equal(button.disabled, true);
  await button.listeners.get('click')();
  assert.equal(flow.requests.some((request) => request.method === 'POST'), false);
  const checkbox = flow.byId.get('confirmUnreceived');
  checkbox.checked = true;
  checkbox.listeners.get('change')();
  assert.equal(button.disabled, false);
  button.listeners.get('click')();
  await flush(); await flush();
  const sent = flow.requests.find((request) => request.method === 'POST');
  assert.equal(sent.body.action, 'retry');
  assert.equal(sent.body.retryUnconfirmed, true);
  assert.equal(sent.body.leadId, id);
});

test('legacy alert redirects carry only an opaque valid record ID', () => {
  for (const [search, expected] of [
    [`?lead=${id}&nome=Maria&contacto=912345678`, `/leads.html?lead=${id}`],
    ['?lead=invalid&nome=Maria&contacto=912345678', '/leads.html'],
    ['?name=Maria&phone=912345678', '/leads.html']
  ]) {
    let actual;
    vm.runInNewContext(redirect, {location:{search,replace:(value)=>{actual=value;}},URLSearchParams});
    assert.equal(actual, expected);
  }
});
