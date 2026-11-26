import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = (await Promise.all(['editorial-preview.js', 'whatsapp-editorial.js'].map(name =>
  readFile(new URL('../' + name, import.meta.url), 'utf8')))).join('\n');
const html = await readFile(new URL('../rotina.html', import.meta.url), 'utf8');
const origin = 'https://autovalorpt-assistente.vercel.app', simulatorUrl = 'https://carregador.vercel.app/';
const mediaUrl = '/api/stock?integration=editorial-image&date=2026-11-26&slide=1&v=v4';
const tip = { id: 'editorial-day', date: '2026-11-26', title: 'Custo por 100 km', caption: 'Link do perfil.',
  shareCaption: 'Simulador ' + simulatorUrl, simulatorUrl, media: [{ url: mediaUrl, mime: 'image/jpeg' }], status: 'ready' };

function harness({ shared = async () => {}, list = () => [tip], claim, canShare = true } = {}) {
  const elements = new Map(), requests = [], clipboard = [], native = [];
  class Element {
    constructor() { this.hidden = false; this.children = []; this.events = {}; }
    addEventListener(name, callback) { this.events[name] = callback; }
    appendChild(item) { this.children.push(item); }
    replaceChildren() { this.children = []; }
  }
  const get = id => { assert.ok(html.includes('id="' + id + '"'), id); if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  const ctx = vm.createContext({ document: {getElementById:get,createElement:()=>new Element()},
    location: { origin, hash: '#estado-whatsapp' }, addEventListener() {}, AbortSignal, File, URL, URLSearchParams, crypto,
    confirm: () => true, navigator: { clipboard: { writeText: async x=>clipboard.push(x) },
      canShare:()=>canShare, share: async content=>{native.push(content.files); await shared();} },
    fetch: async (url, init) => {
      const action = new URL(url, origin).searchParams.get('action'); requests.push({ action, init });
      if (!action) return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});
      const body = init.body && JSON.parse(init.body);
      if (action === 'tip-list') return Response.json({ok:true,items:structuredClone(list())});
      if (action === 'tip-claim') return claim?.(body) || Response.json({ok:true,status:'unconfirmed',attemptId: body.requestId});
      return Response.json({ok:true,status:action === 'tip-confirm' ? 'confirmed' : 'ready',attemptId:body.attemptId});
    } });
  vm.runInContext(code,ctx);
  return { get, requests, native, clipboard, api:ctx.AutoValorWhatsappEditorial, click:id=>get(id).events.click() };
}

test('a daily or extra tip is loaded on demand; preparing, opening the share sheet and dismissing it never confirm delivery', async () => {
  const app=harness(); app.api.setSession(true);
  assert.equal(app.get('estado-whatsapp').open,true); assert.equal(app.requests.length,0);
  await app.click('waTipRefresh');
  assert.equal(app.get('waTipSelect').children.length,1); assert.equal(app.get('waTipMedia').children[0].src,mediaUrl);
  await app.click('waTipCopy'); await app.click('waTipCopyLink'); assert.deepEqual(app.clipboard,[tip.shareCaption,simulatorUrl]);
  await Promise.all([app.click('waTipPrepare'),app.click('waTipPrepare')]);
  assert.equal(app.get('waTipShare').hidden,false); assert.equal(app.get('waTipDownloads').children.length,1);
  assert.deepEqual(app.requests.map(r=>r.action),['tip-list',null,'tip-claim']);
  await Promise.all([app.click('waTipShare'),app.click('waTipShare')]);
  assert.equal(app.native.length,1); assert.equal(app.native[0][0].type,'image/jpeg');
  assert.equal(app.get('waTipHandoff').hidden,true); assert.equal(app.get('waTipReview').hidden,false);
  assert.ok(!app.requests.some(r=>r.action==='tip-confirm'));
  await app.click('waTipConfirm'); assert.match(app.get('waTipMessage').textContent,/registada como visível/);
  assert.ok(JSON.parse(app.requests.at(-1).init.body).observed);
});

test('a previous uncertain handoff cannot be shared again on refresh; releasing requires an explicit operator decision', async () => {
  const row={...tip,status:'unconfirmed',attemptId:crypto.randomUUID(),extra:true,
    media:[{url:mediaUrl+'&extra=1',mime:'image/jpeg'}]};
  const app=harness({list:()=>[row]});app.api.setSession(true); await app.click('waTipRefresh');
  assert.equal(app.get('waTipPrepare').hidden,true);
  await app.click('waTipPrepare');await app.click('waTipShare');assert.equal(app.requests.length,1);
  await app.click('waTipRelease');assert.equal(app.get('waTipPrepare').hidden,false);
  assert.deepEqual(JSON.parse(app.requests.at(-1).init.body),{id:row.id,attemptId:row.attemptId,notSent:true});
});

test('a claim conflict exposes no files; unsupported native share provides a download, and logout clears private captions and controls',async () => {
  const app=harness({claim:()=>Response.json({ok:false},{status:409})});app.api.setSession(true);await app.click('waTipRefresh');await app.click('waTipPrepare');
  assert.match(app.get('waTipMessage').textContent,/registo mudou/);assert.equal(app.get('waTipHandoff').hidden,true);
  const desktop=harness({canShare:false,list:()=>[{...tip,media:[{url:'https://wrong.example/image.jpg',mime:'image/jpeg'}]},tip]});
  desktop.api.setSession(true);await desktop.click('waTipRefresh');await desktop.click('waTipPrepare');
  assert.equal(desktop.get('waTipSelect').children.length,1);assert.equal(desktop.get('waTipShare').hidden,true);
  assert.equal(desktop.get('waTipDownloads').children[0].href,mediaUrl);
  desktop.api.setSession(false);assert.equal(desktop.get('waTipCaption').textContent,'');assert.equal(desktop.get('waTipPicker').hidden,true);
});
