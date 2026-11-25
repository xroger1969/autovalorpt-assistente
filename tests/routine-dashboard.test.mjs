import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../rotina.js', import.meta.url), 'utf8');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const startedAt = `${today()}T08:00:00Z`;
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

async function dashboard(options = {}) {
  const elements = new Map(); const calls = []; let interval;
  const element = () => ({ textContent: '', className: '', children: [], hidden: false, checked: true, value: '', handlers: {},
    addEventListener(name, callback) { this.handlers[name] = callback; }, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, removeAttribute(name) { delete this[name]; }, getAttribute(name) { return this[name] || null; } });
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const fetch = async (endpoint, init = {}) => {
    calls.push({ endpoint, init });
    if (options.fetch) { const custom = await options.fetch(endpoint, init); if (custom) return custom; }
    if (endpoint === '/api/admin-session') return response({ authenticated: options.authenticated !== false, configured: true });
    const u = new URL(endpoint, 'https://example.invalid'); const integration = u.searchParams.get('integration');
    if (integration === 'morning-flow') return response(options.cycle || { ok: true, status: 'not_started', day: u.searchParams.get('day') });
    if (integration === 'meta-catalog') return response(options.catalog || { configuration: { enabled: false }, lastResult: { status: 'authorization_required', sourceCount: 9, expectedCount: 9, actualCount: null, checkedAt: startedAt, authorization: { ready: false } } });
    if (integration === 'editorial') return response(options.editorial || {ok:true,enabled:true,configuration:{production:true,tokenConfigured:true,accountConfigured:true,validApi:true,imagesConfigured:true},schedule:{nextRunAt:today()+'T19:00:00Z'},history:[]});
    if (integration === 'whatsapp-status') return response(options.whatsapp || { ok: true, role: 'admin', automation: 'pending_end_to_end_test', device: null, active: null, blocked: false, lastResult: null });
    return response({ configuration: { enabled: true }, lastResult: { status: 'no_new_stock', at: startedAt, published: 0 } });
  };
  vm.runInNewContext(script, { document, fetch, location: { hash: options.hash || '' }, URL, URLSearchParams, Date, Intl, AbortController, setTimeout, clearTimeout, setInterval: callback => { interval = callback; } });
  await new Promise(resolve => setImmediate(resolve));
  return { get: id => document.getElementById(id), calls, document, tick: () => interval() };
}

test('private monitor makes no status requests before authentication', async () => {
  const app = await dashboard({ authenticated: false });
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('loginView').hidden, false);
  assert.deepEqual(app.calls.map(call => call.endpoint), ['/api/admin-session']);
  app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, 1);
});

test('counts stay independent and a finished cycle does not hide catalog authorization failure', async () => {
  const app = await dashboard({ cycle: { status: 'finished', day: today(), startedAt, updatedAt: startedAt, results: {
    source: { status: 'source_matches', ok: true, at: startedAt }, catalog: { status: 'authorization_required', ok: false, catalogConfirmed: false, at: startedAt }, verify: { status: 'checked', ok: true, catalogConfirmed: false, at: startedAt }
  } } });
  assert.equal(app.get('sourceCount').textContent, '9');
  assert.equal(app.get('feedCount').textContent, '9');
  assert.equal(app.get('metaCount').textContent, '—');
  assert.equal(app.get('cycleBadge').textContent, 'Terminada com pendências');
  assert.match(app.get('catalogSummary').textContent, /importação horária.*continuar/);
  assert.match(app.get('catalogAccess').textContent, /por confirmar/);
  assert.ok(app.calls.filter(call => call.endpoint !== '/api/admin-session').every(call => !call.init.method || call.init.method === 'GET'));
});

test('a Story read failure remains visible while the catalog result is shown', async () => {
  const app = await dashboard({ catalog: { configuration: { enabled: true }, lastResult: { catalogConfirmed: true, actualCount: 9, sourceCount: 9, expectedCount: 9, authorization: { ready: true } } },
    fetch: endpoint => endpoint.includes('stories-status') ? response({ error: 'story_state_invalid' }, 503) : null });
  assert.match(app.get('storySummary').textContent, /histórico das Stories precisa de verificação/);
  assert.equal(app.get('catalogBadge').textContent, 'Dados conferidos na Meta');
  assert.equal(app.get('metaCount').textContent, '9');
  assert.match(app.get('dashboardStatus').textContent, /Alguns registos/);
  assert.equal(app.get('dashboardView').hidden, false);
});

test('expired access hides and clears results rather than leaving stale private data', async () => {
  const app = await dashboard({ fetch: endpoint => endpoint.includes('stories-status') ? response({ error: 'private_access_required' }, 401) : null });
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('privateNav').hidden, true);
  assert.equal(app.get('sourceCount').textContent, '—');
  assert.equal(app.get('stepsList').children.length, 0);
  assert.match(app.get('loginStatus').textContent, /sessão terminou/);
});

test('last cycle search stops at a recorded day and never marks today started', async () => {
  let dayReads = 0;
  const app = await dashboard({ fetch: endpoint => {
    if (!endpoint.includes('morning-flow') || endpoint.includes('mode=manual')) return null;
    dayReads++;
    return dayReads === 3 ? response({ status: 'finished', startedAt: '2026-11-12T08:00:00Z' }) : null;
  } });
  assert.equal(dayReads, 1);
  app.get('historyPanel').open = true;
  app.get('historyPanel').handlers.toggle();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dayReads, 3);
  assert.equal(app.get('cycleBadge').textContent, 'Ainda não iniciada');
  assert.match(app.get('latestCycle').textContent, /Última execução encontrada/);
  assert.match(app.get('cycleSummary').textContent, /Não há uma execução registada para este dia/);
});

test('hidden page does not poll and rendered provider content is never used as HTML', async () => {
  const app = await dashboard({ cycle: { status: 'finished', day: today(), startedAt, results: {} }, catalog: { lastResult: { status: '<img src=x onerror=alert(1)>', actualCount: '9' } } });
  const before = app.calls.length; app.document.hidden = true; app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, before);
  assert.equal(app.get('catalogBadge').textContent, 'Resultado por confirmar');
  assert.equal(app.get('metaCount').textContent, '—');
  assert.equal(app.get('cycleBadge').textContent, 'Terminada com pendências');
  assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage/);
});

function finishedCycle() {
  return { status: 'finished', day: today(), startedAt, updatedAt: startedAt, results: Object.fromEntries([
    ['source', 'source_matches'], ['catalog', 'catalog_matches'], ['retirements', 'no_retirements'], ['photo', 'no_new_stock'], ['story', 'no_new_stock'], ['verify', 'checked']
  ].map(([key, status]) => [key, { status, ok: true, at: startedAt, catalogConfirmed: true }])), verification: {
    catalog: { status: 'catalog_matches', ok: true, catalogConfirmed: true }, retirements: { status: 'retired', ok: false, active: false },
    photo: { status: 'published', ok: false, active: false }, story: { status: 'published', ok: false, active: false }
  } };
}

test('active catalog import overrides a successful old diagnostic without inventing new counts', async () => {
  const app = await dashboard({ catalog: { active: { phase: 'unknown', startedAt }, configuration: { enabled: true }, lastResult: {
    status: 'catalog_matches', catalogConfirmed: true, actualCount: 8, sourceCount: 8, expectedCount: 8, checkedAt: '2026-11-13T08:00:00Z'
  } } });
  assert.equal(app.get('catalogBadge').textContent, 'Operação por confirmar');
  assert.equal(app.get('catalogBadge').className, 'badge pending');
  assert.equal(app.get('metaCount').textContent, '8');
  assert.match(app.get('catalogSummary').textContent, /último diagnóstico/);
});

test('failed final Story verification is visible even after all operations finished', async () => {
  const cycle = finishedCycle(); cycle.verification.story = { status: 'unverified', ok: false };
  const app = await dashboard({ cycle });
  assert.equal(app.get('cycleBadge').textContent, 'Terminada com pendências');
  const row = app.get('stepsList').children.at(-1);
  assert.equal(row.children[1].textContent, 'Verificação com pendências');
  assert.match(row.children.at(-1).textContent, /Stories/);
});

test('no retirements and published historical results without ok do not create a false failure', async () => {
  const app = await dashboard({ cycle: finishedCycle() });
  assert.equal(app.get('cycleBadge').textContent, 'Etapas do servidor terminadas');
  assert.equal(app.get('stepsList').children[2].children[1].textContent, 'Sem retiradas pendentes');
  assert.equal(app.get('stepsList').children.at(-1).children[1].textContent, 'Verificação terminada');
});

test('active photo configuration does not hide an expired or failed token renewal', async () => {
  for (const authorization of [{ expired: true }, { lastError: 'private provider error text' }]) {
    const app = await dashboard({ fetch: endpoint => endpoint.includes('integration=instagram-sync&action=status') ? response({ configuration: { enabled: true }, authorization, lastResult: { status: 'published', at: startedAt } }) : null });
    assert.match(app.get('photoSummary').textContent, authorization.expired ? /Autorização expirada/ : /renovação do acesso precisa de verificação/);
    assert.doesNotMatch(app.get('photoSummary').textContent, /private provider/);
  }
});

test('a readable final check with unknown outcome remains unconfirmed', async () => {
  const cycle = finishedCycle(); cycle.verification.retirements = { status: 'unknown', ok: true, active: false };
  const app = await dashboard({ cycle });
  assert.equal(app.get('cycleBadge').textContent, 'Terminada com pendências');
  assert.match(app.get('stepsList').children.at(-1).children.at(-1).textContent, /retiradas/);
});

test('WhatsApp observed publication is separate from automatic execution and device access', async () => {
  const app = await dashboard({ whatsapp: { automation: 'pending_end_to_end_test', device: { valid: true, expiresAt: '2027-02-12T08:00:00Z' }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: startedAt, observation: 'Viatura e preço visíveis no meu Estado.' } } });
  assert.equal(app.get('whatsappBadge').textContent, 'Última publicação observada');
  assert.match(app.get('whatsappSummary').textContent, /Automação ainda em validação/);
  assert.match(app.get('whatsappAccess').textContent, /sessão ligada no WhatsApp é verificada separadamente/);
  assert.match(app.get('whatsappLast').textContent, /IDabcde1.*observada.*Não é uma confirmação da API/);
  assert.ok(app.calls.some(call => call.endpoint.includes('integration=whatsapp-status&action=status') && !call.init.method));
});

test('uncertain WhatsApp attempt overrides an earlier observed publication and revocation remains explicit', async () => {
  const app = await dashboard({ whatsapp: { automation: 'pending_end_to_end_test', blocked: true, active: { phase: 'unknown', startedAt }, device: { valid: false, revokedAt: startedAt }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: '2026-11-13T08:00:00Z' } } });
  assert.equal(app.get('whatsappBadge').textContent, 'Resultado incerto — não repetir');
  assert.equal(app.get('whatsappBadge').className, 'badge error');
  assert.match(app.get('whatsappAccess').textContent, /revogado.*não termina a sessão no WhatsApp/);
  assert.match(app.get('whatsappTime').textContent, /Tentativa atual:.*Último registo:/);
});

test('closed WhatsApp attempt does not claim publication and read failure does not hide other services', async () => {
  const closed = await dashboard({ whatsapp: { automation: 'pending_end_to_end_test', device: { valid: true, expiresAt: startedAt }, lastResult: { status: 'closed_without_publication_confirmation', id: 'IDabcde1', at: startedAt } } });
  assert.equal(closed.get('whatsappBadge').textContent, 'Tentativa encerrada sem confirmação');
  assert.match(closed.get('whatsappLast').textContent, /sem confirmação de publicação/);
  const unavailable = await dashboard({ fetch: endpoint => endpoint.includes('integration=whatsapp-status') ? response({ error: 'status_state_invalid' }, 503) : null });
  assert.equal(unavailable.get('whatsappBadge').textContent, 'Leitura indisponível');
  assert.equal(unavailable.get('dashboardView').hidden, false);
  assert.equal(unavailable.get('sourceCount').textContent, '9');
});

test('WhatsApp private observation is cleared when authentication expires', async () => {
  let expired = false;
  const app = await dashboard({ whatsapp: { automation: 'pending_end_to_end_test', device: { valid: true }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: startedAt, observation: 'Uma observação privada.' } }, fetch: endpoint => endpoint.includes('mode=manual') ? response({ status: 'finished', results: {} }) : expired && endpoint.includes('integration=whatsapp-status') ? response({ error: 'status_unauthorized' }, 401) : null });
  assert.match(app.get('whatsappLast').textContent, /observação privada/);
  expired = true; await app.get('runNow').handlers.click();
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('whatsappLast').textContent, '');
  assert.equal(app.get('whatsappBadge').textContent, 'Por consultar');
});

test('observed WhatsApp test reports first scheduled execution still pending', async () => {
  const app = await dashboard({ whatsapp: { automation: 'publication_observed_scheduled_test_pending', device: { valid: true }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: startedAt } } });
  assert.match(app.get('whatsappSummary').textContent, /Publicação observada neste dispositivo.*primeira execução agendada/);
  assert.doesNotMatch(app.get('whatsappSummary').textContent, /falta concluir o teste no WhatsApp/);
});

test('WhatsApp withdrawal proof and uncertainty remain separate from publication and expiry', async () => {
  const data = { automation: 'publication_observed_scheduled_test_pending', device: { valid: true }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: startedAt }, lastWithdrawalResult: { status: 'observed_removed', id: 'IDabcde1', observedAt: startedAt, observation: 'Eliminei o vídeo exato e deixou de aparecer.' } };
  const removed = await dashboard({ whatsapp: data });
  assert.equal(removed.get('whatsappBadge').textContent, 'Eliminação observada');
  assert.match(removed.get('whatsappLast').textContent, /publicação observada/);
  assert.match(removed.get('whatsappWithdrawal').textContent, /Eliminação de IDabcde1 observada.*Não é uma confirmação da API/);
  const uncertain = await dashboard({ whatsapp: { ...data, active: { kind: 'withdrawal', phase: 'unknown', startedAt }, blocked: true } });
  assert.equal(uncertain.get('whatsappBadge').textContent, 'Retirada incerta — não repetir');
  const closed = await dashboard({ whatsapp: { ...data, lastWithdrawalResult: { status: 'closed_without_removal_confirmation', at: startedAt } } });
  assert.equal(closed.get('whatsappBadge').textContent, 'Retirada encerrada sem confirmação');
  assert.match(closed.get('whatsappWithdrawal').textContent, /sem confirmação de eliminação/);
});

test('the main action submits one manual request, including a double tap and a stale first read', async () => {
  let resolveStart; let state = { status: 'not_started' };
  const app = await dashboard({ fetch: (path, init) => {
    if (path.includes('action=manual-start')) {
      assert.equal(init.method, 'POST');
      return new Promise(resolve => { resolveStart = resolve; });
    }
    if (path.includes('mode=manual')) return response(state);
    return null;
  } });
  assert.equal(app.get('runNow').disabled, false);
  const first = app.get('runNow').handlers.click();
  await app.get('runNow').handlers.click();
  assert.equal(app.get('runNow').disabled, true);
  resolveStart(response({ status: 'queued', day: today() }, 202));
  await first;
  assert.equal(app.get('runNow').disabled, false);
  assert.equal(app.get('runNow').textContent, 'Ver progresso');
  await app.get('runNow').handlers.click();
  assert.equal(app.calls.filter(c => c.init.method === 'POST').length, 1);
  state = { status: 'finished', verification: { catalog: { catalogConfirmed: false } }, results: { photo: { status: 'published' }, story: { status: 'no_new_stock' } } };
  await app.get('runNow').handlers.click();
  assert.equal(app.get('runNow').textContent, 'Verificar tudo');
  await app.get('runNow').handlers.click();
  assert.equal(app.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.match(app.get('manualOutcome').textContent, /Catálogo · Por confirmar/);
  assert.match(app.get('manualOutcome').textContent, /Publicação confirmada/);
  assert.equal(app.calls.filter(c => c.init.method === 'POST').length, 1);
});

test('consultation of stalled manual work is read-only and an explicit continuation uses the original cycle', async () => {
  let resumed = false;
  const app = await dashboard({ fetch: (path, init) => {
    if (path.includes('action=resume')) { resumed = true; assert.equal(init.method, 'POST'); assert.match(path, /mode=manual/); return response({ status: 'queued', day: today() }); }
    if (path.includes('mode=manual')) return response(resumed ? { status: 'running', step: 'catalog' } :
      { status: 'queued', startedAt: new Date(Date.now() - 700000).toISOString(), updatedAt: new Date(Date.now() - 480000).toISOString(), stalled: true });
    return null;
  } });
  await app.get('refreshButton').handlers.click();
  assert.equal(app.get('runNow').textContent, 'Continuar atualização');
  assert.equal(resumed, false);
  await app.get('runNow').handlers.click();
  assert.equal(resumed, true);
  assert.match(app.get('manualStatus').textContent, /catálogo/i);
  assert.equal(app.calls.some(c => c.endpoint.includes('manual-start')), false);
});

test('an unreadable manual state allows only read-only retry without hiding other channels', async () => {
  const app = await dashboard({ fetch: path => path.includes('mode=manual') ? response({ error: 'unavailable' }, 503) : null });
  assert.equal(app.get('runNow').disabled, false);
  assert.equal(app.get('runNow').textContent, 'Verificar tudo');
  assert.match(app.get('manualStatus').textContent, /verificar novamente/);
  assert.equal(app.get('dashboardView').hidden, false);
  assert.equal(app.get('sourceCount').textContent, '9');
  const readsBefore = app.calls.filter(c => c.endpoint.includes('mode=manual')).length;
  await app.get('runNow').handlers.click();
  assert.ok(app.calls.filter(c => c.endpoint.includes('mode=manual')).length > readsBefore);
  assert.equal(app.calls.some(c => c.init.method === 'POST'), false);
});

test('the installed shortcut loads the same panel and only resumes existing queued work', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.redirects.find(rule => rule.source === '/stock-rapido.html').destination, '/rotina.html#atalho');
  let state = 'queued';
  const app = await dashboard({ hash: '#atalho', fetch: path => {
    if (path.includes('action=resume')) { state = 'running'; return response({ status: state }); }
    if (path.includes('mode=manual')) return response({ status: state, startedAt: new Date(Date.now() - 180000).toISOString(), updatedAt: new Date(Date.now() - 120000).toISOString() });
    return null;
  } });
  assert.equal(app.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(app.calls.some(c => c.endpoint.includes('manual-start')), false);
});

test('a matching label without explicit Meta confirmation stays unconfirmed', async () => {
  const app = await dashboard({ catalog: { lastResult: { status: 'catalog_matches', catalogConfirmed: false } } });
  assert.equal(app.get('catalogBadge').textContent, 'Catálogo por confirmar');
});

test('idle and unreadable dashboards do not poll Blob automatically', async () => {
  for (const app of [
    await dashboard(),
    await dashboard({ fetch: endpoint => endpoint.includes('mode=manual') ? response({ error: 'unavailable' }, 503) : null })
  ]) {
    const before = app.calls.length;
    for (let i = 0; i < 10; i++) { app.tick(); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(app.calls.length, before);
  }
});

test('active cycle polls only its own status and refreshes channels once after completion', async () => {
  let state = { status: 'running' };
  const app = await dashboard({ fetch: endpoint => endpoint.includes('mode=manual') ? response(state) : null });
  const before = app.calls.length;
  app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, before + 1);
  assert.match(app.calls.at(-1).endpoint, /mode=manual/);
  state = { status: 'finished', results: {} };
  app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, before + 8);
  assert.equal(app.get('runNow').textContent, 'Verificar tudo');
  const completed = app.calls.length;
  app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.calls.length, completed);
  assert.ok(app.calls.every(c => !c.init.method || c.init.method === 'GET'));
});

test('unified button reads creative editorial state and never starts its publication', async () => {
  const status = {ok:true,enabled:true,configuration:{production:true,tokenConfigured:true,accountConfigured:true,validApi:true,imagesConfigured:true},schedule:{nextRunAt:today()+'T19:00:00Z'},nextPost:{date:today(),title:'Conteúdo de hoje',caption:'Legenda original.',format:'IMAGE',slideCount:1,images:['/api/stock?integration=editorial-image&version=v1']},lastResult:{status:'published',at:startedAt},history:[{date:today(),status:'published',title:'Histórico',permalink:'https://www.instagram.com/p/ABC/'},{date:today(),status:'published',title:'Inválido',permalink:'https://example.invalid/p/ABC/'}]};
  const app = await dashboard({editorial:status,cycle:{status:'finished',results:{}}});
  assert.match(app.get('editorialBadge').textContent,/Rotina ativa/);
  assert.equal(app.get('editorialTitle').textContent,'Conteúdo de hoje');
  assert.equal(app.get('editorialCaption').textContent,'Legenda original.');
  assert.match(app.get('editorialResult').textContent,/Publicação confirmada/);
  assert.equal(app.get('editorialHistory').children[0].children.at(-1).href,'https://www.instagram.com/p/ABC/');
  assert.equal(app.get('editorialHistory').children[1].children.at(-1).href,undefined);
  assert.equal(app.get('editorialImage').src,undefined);
  app.get('editorialPanel').open=true; app.get('editorialPanel').handlers.toggle();
  assert.ok(app.get('editorialImage').src.startsWith('/api/stock?integration=editorial-image'));
  const before=app.calls.filter(c=>c.endpoint.includes('integration=editorial&action=status')).length;
  await app.get('runNow').handlers.click();
  assert.equal(app.calls.filter(c=>c.endpoint.includes('integration=editorial&action=status')).length,before+1);
  assert.ok(app.calls.filter(c=>c.endpoint.includes('integration=editorial')).every(c=>!c.init.method || c.init.method==='GET'));
  assert.ok(app.calls.every(c=>!c.endpoint.includes('action=run')));
});
test('editorial failures and pause remain visible without hiding the catalogue', async () => {
  const failure=await dashboard({fetch:path=>path.includes('integration=editorial&action=status')?response({error:'unavailable'},503):null});
  assert.equal(failure.get('editorialBadge').textContent,'Leitura indisponível');
  assert.equal(failure.get('sourceCount').textContent,'9');
  const paused=await dashboard({editorial:{ok:true,enabled:false,configuration:{production:true,tokenConfigured:true,accountConfigured:true,validApi:true,imagesConfigured:true},history:[]}});
  assert.equal(paused.get('editorialBadge').textContent,'Rotina pausada');
  assert.equal(paused.get('editorialSchedule').textContent,'Rotina pausada.');
});
test('editorial private details are cleared on session expiry',async()=>{
  let expired=false;
  const app=await dashboard({cycle:{status:'finished',results:{}},editorial:{ok:true,enabled:true,nextPost:{date:today(),format:'IMAGE',slideCount:1,title:'Privado',caption:'Legenda privada'},history:[]},fetch:path=>expired&&path.includes('integration=editorial&action=status')?response({error:'private_access_required'},401):null});
  assert.equal(app.get('editorialCaption').textContent,'Legenda privada');
  expired=true; await app.get('runNow').handlers.click();
  assert.equal(app.get('dashboardView').hidden,true); assert.equal(app.get('editorialCaption').textContent,''); assert.equal(app.get('editorialHistory').children.length,0);
});

test('extra publication is a separate explicitly pressed action and status refresh never publishes',async()=>{
  const state={ok:true,enabled:true,configuration:{production:true,tokenConfigured:true,accountConfigured:true,validApi:true,imagesConfigured:true},extra:{available:true,nextPost:{title:'Nova pergunta'}}};
  let sent=0;
  const app=await dashboard({editorial:state,fetch:(path,init)=>{if(path.includes('action=extra-run')){assert.equal(init.method,'POST'); sent++; state.extra={available:false,usedToday:true}; return response({ok:true,status:'published'});} return null;}});
  assert.equal(sent,0); assert.equal(app.get('extraButton').disabled,false);
  await app.get('refreshButton').handlers.click(); assert.equal(sent,0);
  await app.get('extraButton').handlers.click(); await app.get('extraButton').handlers.click(); assert.equal(sent,1); assert.equal(app.get('extraButton').disabled,true);
});

test('intentional preservation of Instagram posts is not an outstanding retirement',async()=>{
  const cycle=finishedCycle();
  cycle.results.retirements={status:'preserved',ok:true,retired:0,at:startedAt};
  cycle.verification.retirements={status:'preserved',ok:true,retired:0,active:false};
  const app=await dashboard({cycle});
  assert.equal(app.get('cycleBadge').textContent,'Etapas do servidor terminadas');
  assert.equal(app.get('stepsList').children[2].children[1].textContent,'Publicações preservadas');
});
