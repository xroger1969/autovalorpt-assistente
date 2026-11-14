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
    addEventListener(name, callback) { this.handlers[name] = callback; }, replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); } });
  const document = { hidden: false, getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  const fetch = async (endpoint, init = {}) => {
    calls.push({ endpoint, init });
    if (options.fetch) { const custom = await options.fetch(endpoint, init); if (custom) return custom; }
    if (endpoint === '/api/admin-session') return response({ authenticated: options.authenticated !== false, configured: true });
    const u = new URL(endpoint, 'https://example.invalid'); const integration = u.searchParams.get('integration');
    if (integration === 'morning-flow') return response(options.cycle || { ok: true, status: 'not_started', day: u.searchParams.get('day') });
    if (integration === 'meta-catalog') return response(options.catalog || { configuration: { enabled: false }, lastResult: { status: 'authorization_required', sourceCount: 9, expectedCount: 9, actualCount: null, checkedAt: startedAt, authorization: { ready: false } } });
    if (integration === 'whatsapp-status') return response(options.whatsapp || { ok: true, role: 'admin', automation: 'pending_end_to_end_test', device: null, active: null, blocked: false, lastResult: null });
    return response({ configuration: { enabled: true }, lastResult: { status: 'no_new_stock', at: startedAt, published: 0 } });
  };
  vm.runInNewContext(script, { document, fetch, URLSearchParams, Date, Intl, AbortController, setTimeout, clearTimeout, setInterval: callback => { interval = callback; } });
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
    if (!endpoint.includes('morning-flow')) return null;
    dayReads++;
    return dayReads === 3 ? response({ status: 'finished', startedAt: '2026-11-12T08:00:00Z' }) : null;
  } });
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
  const app = await dashboard({ whatsapp: { automation: 'pending_end_to_end_test', device: { valid: true }, lastResult: { status: 'observed_published', id: 'IDabcde1', observedAt: startedAt, observation: 'Uma observação privada.' } }, fetch: endpoint => expired && endpoint.includes('integration=whatsapp-status') ? response({ error: 'status_unauthorized' }, 401) : null });
  assert.match(app.get('whatsappLast').textContent, /observação privada/);
  expired = true; app.tick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get('dashboardView').hidden, true);
  assert.equal(app.get('whatsappLast').textContent, '');
  assert.equal(app.get('whatsappBadge').textContent, 'Por consultar');
});
