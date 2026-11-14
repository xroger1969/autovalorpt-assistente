(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STEPS = [['source', 'Stock Samucar e ficheiro'], ['catalog', 'Catálogo Meta / WhatsApp'], ['retirements', 'Retirada de viaturas'], ['photo', 'Fotografia Instagram'], ['story', 'Vídeo e Story Instagram'], ['verify', 'Verificação final']];
  const LABELS = { source_matches: 'Stock conferido', source_waiting: 'A aguardar o ficheiro', catalog_matches: 'Catálogo conferido', matched: 'Catálogo conferido', synced: 'Catálogo conferido', published: 'Publicação confirmada', mapped: 'Publicação confirmada', no_new_stock: 'Sem novas viaturas', retired: 'Retirada confirmada', canceled: 'Cancelado', checked: 'Verificação terminada', disabled: 'Desativado', authorization_required: 'Autorização pendente', sync_disabled: 'Correção desativada', import_requested: 'Importação pedida', import_pending: 'Importação em curso', upload_requested: 'Importação pedida', upload_pending: 'Importação em curso', preparing: 'Em processamento', busy: 'Em curso', mapping_pending: 'Confirmação em curso', baseline_initialized: 'Registo inicial criado', review_required: 'Precisa de atenção', source_invalid: 'Origem por confirmar', source_blocked: 'Origem por confirmar', mismatch: 'Diferença encontrada', catalog_mismatch: 'Diferença encontrada', check_failed: 'Verificação por concluir', check_deferred: 'Verificação adiada', deferred: 'Adiado', unknown: 'Resultado por confirmar', publish_unknown: 'Publicação por confirmar', import_unknown: 'Importação por confirmar', ready: 'Vídeo pronto', preview_ready: 'Vídeo pronto', expired: 'Story expirado', products_pending: 'Aprovação pendente', products_rejected: 'Artigos rejeitados', unverified: 'Por confirmar' };
  Object.assign(LABELS, { no_retirements: 'Sem retiradas pendentes', partial: 'Concluído parcialmente', failed: 'Operação não concluída', upload_unknown: 'Importação por confirmar' });
  const GOOD = new Set(['source_matches', 'catalog_matches', 'matched', 'synced', 'published', 'mapped', 'no_new_stock', 'retired', 'canceled', 'expired']);
  const ISSUES = new Set(['review_required', 'source_invalid', 'source_blocked', 'mismatch', 'catalog_mismatch', 'check_failed', 'unknown', 'publish_unknown', 'import_unknown', 'products_rejected']);
  GOOD.add('no_retirements'); for (const code of ['partial', 'failed', 'upload_unknown', 'unverified']) ISSUES.add(code);
  const ERRORS = { story_state_invalid: 'O histórico das Stories precisa de verificação. Não foi possível consultar o resultado.', story_provider_binding_changed: 'A ligação das Stories precisa de verificação.', morning_flow_unavailable: 'Não foi possível consultar esta execução.', catalog_permission_required: 'Falta acesso de servidor ao catálogo.' };
  let authenticated = false; let busy = false; let generation = 0; let latestDay = null; let searchedDay = null; let followingToday = true;
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 5000 ? String(value) : '—';
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function date(value) { const d = new Date(value || ''); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'medium', timeStyle: 'short' }).format(d) : 'Data não registada'; }
  function text(id, value) { $(id).textContent = value; }
  function badge(id, value, kind = 'pending') { text(id, value); $(id).className = `badge ${kind}`; }
  function node(tag, value, className) { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; }
  function label(result) { return LABELS[result?.status] || 'Resultado por confirmar'; }
  function kind(result) { return ISSUES.has(result?.status) ? 'error' : result?.remaining > 0 ? 'pending' : (GOOD.has(result?.status) || result?.status === 'checked' && result?.catalogConfirmed === true) && result?.ok !== false ? 'good' : 'pending'; }
  function finalIssues(data) {
    if (!data?.verification) return data?.status === 'finished' ? ['verificação final sem registo'] : [];
    return [['catalog', 'catálogo'], ['retirements', 'retiradas'], ['photo', 'fotografias'], ['story', 'Stories']].filter(([key]) => {
      const r = data.verification[key];
      // The coordinator summarises older lastResult entries without an `ok`
      // field as false. A known published/retired result remains evidence.
      return !r || r.active || ['mapping_pending', 'preparing', 'busy', 'disabled', 'authorization_required', 'sync_disabled', 'import_requested', 'import_pending', 'upload_requested', 'upload_pending', 'check_deferred', 'deferred', 'products_pending'].includes(r.status) || ISSUES.has(r.status) || r.ok === false && !GOOD.has(r.status) || key === 'catalog' && r.catalogConfirmed !== true;
    }).map(([, name]) => name);
  }
  function errorText(error) { return ERRORS[error?.code] || 'Leitura indisponível. O resultado fica por confirmar.'; }
  function url(integration, action, day) { const q = new URLSearchParams({ integration, action }); if (validDay(day)) q.set('day', day); return `/api/stock?${q}`; }
  async function api(endpoint, options = {}) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw Object.assign(new Error('Consulta indisponível'), { status: response.status, code: typeof data?.error === 'string' ? data.error : '' });
      return data;
    } finally { clearTimeout(timer); }
  }
  function sessionView(value, message = '') {
    authenticated = value; generation++;
    $('dashboardView').hidden = !value; $('privateNav').hidden = !value; $('loginView').hidden = value;
    $('accessCode').value = ''; $('loginButton').disabled = false; text('loginStatus', message);
    if (!value) {
      latestDay = null; searchedDay = null;
      for (const id of ['readAt', 'dashboardStatus', 'cycleSummary', 'cycleTime', 'latestCycle', 'catalogSummary', 'catalogTime', 'catalogAccess', 'photoSummary', 'storySummary', 'whatsappSummary', 'whatsappAccess', 'whatsappLast', 'whatsappTime']) text(id, '');
      for (const id of ['sourceCount', 'feedCount', 'metaCount']) text(id, '—');
      badge('cycleBadge', 'Por consultar'); badge('catalogBadge', 'Por consultar'); badge('whatsappBadge', 'Por consultar'); $('stepsList').replaceChildren();
    }
  }
  function setBusy(value) { busy = value; for (const id of ['refreshButton', 'todayButton', 'cycleDay', 'logoutButton']) $(id).disabled = value; }
  function showCycle(data, error) {
    const list = $('stepsList'); list.replaceChildren();
    const verificationIssues = error ? [] : finalIssues(data);
    if (error) { badge('cycleBadge', 'Leitura indisponível', 'error'); text('cycleSummary', errorText(error)); text('cycleTime', ''); }
    else {
      const pending = verificationIssues.length > 0 || STEPS.some(([key]) => { const r = data.results?.[key]; return !r || r.ok === false || r.remaining > 0 || !GOOD.has(r.status) && !(r.status === 'checked' && r.catalogConfirmed === true); });
      const title = data.stalled ? 'Execução sem avanço confirmado' : ({ not_started: 'Ainda não iniciada', queued: 'Próxima etapa em fila', running: 'Em execução', finished: pending ? 'Terminada com pendências' : 'Etapas do servidor terminadas', blocked: 'Execução bloqueada', interrupted: 'Execução interrompida', production_only: 'Disponível em produção' }[data.status] || 'Resultado por confirmar');
      badge('cycleBadge', title, ['blocked', 'interrupted'].includes(data.status) || data.stalled ? 'error' : 'pending');
      text('cycleSummary', data.status === 'not_started' ? 'Não há uma execução registada para este dia. O horário previsto não comprova que a rotina tenha começado.' : data.status === 'finished' ? 'Consulte o resultado de cada etapa. Os Estados WhatsApp são acompanhados separadamente.' : data.stalled ? 'É necessário confirmar a operação antes de repetir qualquer publicação.' : `Dia da execução: ${data.day || $('cycleDay').value}.`);
      text('cycleTime', data.startedAt ? `Início: ${date(data.startedAt)} · Último registo: ${date(data.updatedAt)}.` : '');
    }
    for (const [key, name] of STEPS) {
      const result = !error && data.results?.[key]; const current = !error && data.step === key && ['queued', 'running'].includes(data.status);
      const item = document.createElement('li'); item.appendChild(node('strong', name));
      item.appendChild(node('span', key === 'verify' && verificationIssues.length ? 'Verificação com pendências' : result ? label(result) : current ? data.status === 'running' ? 'Em execução' : 'Em fila' : error ? 'Por confirmar' : 'Sem registo', `badge ${key === 'verify' && verificationIssues.length ? 'error' : result ? kind(result) : 'pending'}`));
      if (result) {
        const detail = [date(result.at)];
        if (Number.isSafeInteger(result.published)) detail.push(`${result.published} publicação(ões)`);
        if (Number.isSafeInteger(result.retired)) detail.push(`${result.retired} retirada(s)`);
        if (result.remaining > 0) detail.push(`${result.remaining} por tratar`);
        if (result.catalogConfirmed === false) detail.push('Catálogo por confirmar nesta execução');
        if (result.reason && ERRORS[result.reason]) detail.push(ERRORS[result.reason]);
        item.appendChild(node('small', detail.join(' · ')));
      }
      if (key === 'verify' && verificationIssues.length) item.appendChild(node('small', `Por confirmar: ${verificationIssues.join(', ')}.`));
      list.appendChild(item);
    }
  }
  function showCatalog(data, error) {
    const r = data?.lastResult || {};
    const active = !error && data?.active;
    for (const [id, key] of [['sourceCount', 'sourceCount'], ['feedCount', 'expectedCount'], ['metaCount', 'actualCount']]) text(id, error ? '—' : count(r[key]));
    badge('catalogBadge', error ? 'Leitura indisponível' : active ? 'Operação por confirmar' : r.catalogConfirmed === true ? 'Dados conferidos na Meta' : label(r), error ? 'error' : active ? 'pending' : r.catalogConfirmed === true ? 'good' : ISSUES.has(r.status) ? 'error' : 'pending');
    text('catalogSummary', error ? errorText(error) : active ? `Existe uma operação iniciada em ${date(active.startedAt)} ainda sem conclusão confirmada. As contagens apresentadas pertencem ao último diagnóstico, não ao resultado desta operação.` : r.catalogConfirmed === true ? 'Identificadores, preços e disponibilidade conferidos na Meta. A apresentação no WhatsApp é uma verificação separada.' : r.authorization?.ready === false ? 'A verificação e correção pelo servidor aguardam acesso ao catálogo. A importação horária configurada na Meta pode continuar a funcionar.' : 'O diagnóstico ainda não confirma a correspondência do catálogo com o ficheiro.');
    text('catalogTime', r.checkedAt || r.at ? `Diagnóstico: ${date(r.checkedAt || r.at)}.` : 'Ainda sem diagnóstico datado.');
    text('catalogAccess', error ? 'Acesso e configuração por confirmar.' : `Correção automática: ${data?.configuration?.enabled === true ? 'ativa' : 'desativada ou ainda não configurada'}. Acesso de servidor: ${r.authorization?.ready === true ? 'validado no diagnóstico' : 'por confirmar'}.`);
  }
  function showPublication(id, title, data, error) {
    if (error) { text(id, `${title}: ${errorText(error)}`); return; }
    const r = data?.lastResult;
    const access = data?.authorization?.expired === true ? ' Autorização expirada; novas publicações por confirmar.' : data?.authorization?.lastError ? ' A renovação do acesso precisa de verificação.' : '';
    text(id, `${title}: ${data?.active ? 'operação em curso; resultado por confirmar' : r ? label(r) : 'ainda sem resultado registado'}.\nRotina ${data?.configuration?.enabled === true ? 'ativa' : 'desativada ou por configurar'}.${access}${r?.at ? ` Último resultado: ${date(r.at)}.` : ''}${/^ID[A-Za-z0-9]{5,30}$/.test(r?.id || '') ? ` Viatura ${r.id}.` : ''}`);
  }
  function showWhatsapp(data, error) {
    if (error) {
      badge('whatsappBadge', 'Leitura indisponível', 'error');
      text('whatsappSummary', 'Não foi possível consultar o registo dos Estados. A publicação e o acesso ficam por confirmar.');
      for (const id of ['whatsappAccess', 'whatsappLast', 'whatsappTime']) text(id, '');
      return;
    }
    const device = data?.device; const active = data?.active; const last = data?.lastResult;
    const observed = last?.status === 'observed_published';
    const closed = last?.status === 'closed_without_publication_confirmation';
    const vehicle = /^ID[A-Za-z0-9]{5,30}$/.test(last?.id || '') ? last.id : 'Viatura';
    let title = 'Ainda sem publicação observada'; let stateKind = 'pending';
    if (active || data?.blocked) {
      title = ({ reserved: 'Vídeo reservado', publishing: 'Publicação por confirmar', unknown: 'Resultado incerto — não repetir' }[active?.phase] || 'Tentativa por concluir');
      if (active?.phase === 'unknown') stateKind = 'error';
    } else if (!device) title = 'Dispositivo por autorizar';
    else if (!device.valid) { title = device.revokedAt ? 'Acesso aos vídeos revogado' : 'Acesso aos vídeos expirado ou inválido'; stateKind = 'error'; }
    else if (observed) { title = 'Última publicação observada'; stateKind = 'good'; }
    else if (closed) title = 'Tentativa encerrada sem confirmação';
    badge('whatsappBadge', title, stateKind);
    text('whatsappSummary', data?.automation === 'pending_end_to_end_test' ? 'Automação ainda em validação: falta concluir o teste no WhatsApp e na execução agendada. Uma publicação observada não comprova que a rotina inteira seja automática.' : 'Estado da automação por confirmar.');
    text('whatsappAccess', !device ? 'Ainda não existe autorização desta aplicação para obter os vídeos.' : device.revokedAt ? `Acesso aos vídeos revogado em ${date(device.revokedAt)}. Isto não termina a sessão no WhatsApp.` : device.valid ? `Acesso aos vídeos válido até ${date(device.expiresAt)}. A sessão ligada no WhatsApp é verificada separadamente.` : `Acesso aos vídeos expirado ou invalidado. Validade registada: ${date(device.expiresAt)}.`);
    text('whatsappLast', observed ? `${vehicle}: publicação observada no WhatsApp Web.${typeof last.observation === 'string' ? ` ${last.observation.slice(0, 300)}` : ''} Não é uma confirmação da API da Meta.` : closed ? `${vehicle}: tentativa encerrada sem confirmação de publicação. Este carro não será repetido automaticamente.` : 'Ainda não existe uma publicação observada neste registo.');
    text('whatsappTime', active?.startedAt ? `Tentativa atual: ${date(active.startedAt)}.${last?.observedAt || last?.at ? ` Último registo: ${date(last.observedAt || last.at)}.` : ''}` : last?.observedAt || last?.at ? `Último registo: ${date(last.observedAt || last.at)}.` : '');
  }
  async function latestCycle(current, day) {
    if (day !== today()) return 'Está a consultar um dia anterior; os restantes cartões mostram o diagnóstico mais recente de cada serviço.';
    if (current?.startedAt) { latestDay = day; return `Última execução encontrada: ${date(current.startedAt)}.`; }
    if (searchedDay !== day) {
      latestDay = null;
      for (let offset = 1; offset <= 7; offset++) {
        const prior = new Date(`${day}T12:00:00Z`); prior.setUTCDate(prior.getUTCDate() - offset);
        const candidate = prior.toISOString().slice(0, 10);
        const value = await api(url('morning-flow', 'status', candidate));
        if (value.startedAt) { searchedDay = day; latestDay = candidate; return `Última execução encontrada: ${date(value.startedAt)}. Selecione ${candidate} para ver as etapas.`; }
      }
      searchedDay = day;
    } else if (latestDay && latestDay !== day) {
      const value = await api(url('morning-flow', 'status', latestDay));
      if (value.startedAt) return `Última execução encontrada: ${date(value.startedAt)}. Selecione ${latestDay} para ver as etapas.`;
    }
    return 'Não foi encontrado um ciclo nos últimos 7 dias. Os cartões mostram os últimos diagnósticos disponíveis.';
  }
  async function refresh() {
    if (!authenticated || busy) return;
    $('cycleDay').max = today(); if (followingToday) $('cycleDay').value = today();
    const day = $('cycleDay').value; if (!validDay(day)) return;
    setBusy(true); const version = generation; text('dashboardStatus', 'A consultar os registos…');
    try {
      const results = await Promise.allSettled([api(url('morning-flow', 'status', day)), api(url('meta-catalog', 'status')), api(url('instagram-sync', 'status')), api(url('instagram-sync', 'stories-status')), api(url('whatsapp-status', 'status'))]);
      if (version !== generation) return;
      if (results.some(r => r.status === 'rejected' && r.reason.status === 401)) { sessionView(false, 'A sessão terminou. Volte a entrar para consultar os resultados.'); return; }
      const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
      const error = index => results[index].status === 'rejected' ? results[index].reason : null;
      showCycle(value(0), error(0)); showCatalog(value(1), error(1)); showPublication('photoSummary', 'Fotografias', value(2), error(2)); showPublication('storySummary', 'Stories', value(3), error(3)); showWhatsapp(value(4), error(4));
      text('readAt', `Consulta efetuada: ${date(new Date().toISOString())}.`);
      text('dashboardStatus', results.some(r => r.status === 'rejected') ? 'Alguns registos não puderam ser consultados. Os resultados indisponíveis estão identificados abaixo.' : '');
      try { const latest = error(0) ? 'Última execução por confirmar.' : await latestCycle(value(0), day); if (version === generation) text('latestCycle', latest); }
      catch (error) { if (version === generation) { if (error.status === 401) sessionView(false, 'A sessão terminou. Volte a entrar.'); else text('latestCycle', 'Não foi possível procurar a última execução.'); } }
    } finally { if (version === generation || !authenticated) setBusy(false); }
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const access = $('accessCode').value.trim(); if (!access) return;
    $('loginButton').disabled = true; text('loginStatus', 'A verificar o acesso…');
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) }); sessionView(true); await refresh(); }
    catch (error) { $('accessCode').value = ''; text('loginStatus', error.status === 401 ? 'Código de acesso inválido.' : error.status === 429 ? 'Demasiadas tentativas. Aguarde antes de voltar a tentar.' : 'Não foi possível entrar. Tente novamente.'); }
    finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (busy) return; setBusy(true);
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); sessionView(false, 'Sessão terminada.'); }
    catch { text('dashboardStatus', 'Não foi possível terminar a sessão. Tente novamente.'); }
    finally { setBusy(false); }
  });
  $('refreshButton').addEventListener('click', refresh);
  $('cycleDay').value = today(); $('cycleDay').max = today();
  $('cycleDay').addEventListener('change', () => { followingToday = false; refresh(); });
  $('todayButton').addEventListener('click', () => { followingToday = true; refresh(); });
  setInterval(() => { if ($('autoRefresh').checked && !document.hidden) refresh(); }, 30000);
  api('/api/admin-session').then(async session => {
    sessionView(session.authenticated === true, session.configured === false ? 'O acesso privado ainda está a ser configurado.' : '');
    if (session.configured === false) $('loginButton').disabled = true;
    if (authenticated) await refresh();
  }).catch(() => sessionView(false, 'Não foi possível verificar a sessão. Tente entrar novamente.'));
})();
