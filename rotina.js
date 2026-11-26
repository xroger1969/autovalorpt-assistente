(() => {
  'use strict';
  const { imageUrl, renderPreviewLinks, appendHistoryCaptions } = globalThis.AutoValorEditorialPreview;
  const $ = id => document.getElementById(id);
  const STEPS = [['source', 'Stock Samucar + AutoValorPT'], ['catalog', 'Catálogo Meta / WhatsApp'], ['retirements', 'Histórico Instagram'], ['photo', 'Fotografia Instagram'], ['story', 'Vídeo e Story Instagram'], ['verify', 'Verificação final']];
  const LABELS = { source_matches: 'Stock conferido', source_waiting: 'A aguardar o ficheiro', catalog_matches: 'Catálogo conferido', matched: 'Catálogo conferido', synced: 'Catálogo conferido', published: 'Publicação confirmada', mapped: 'Publicação confirmada', no_new_stock: 'Sem novas viaturas', retired: 'Retirada confirmada', canceled: 'Cancelado', checked: 'Verificação terminada', disabled: 'Desativado', authorization_required: 'Autorização pendente', sync_disabled: 'Correção desativada', import_requested: 'Importação pedida', import_pending: 'Importação em curso', upload_requested: 'Importação pedida', upload_pending: 'Importação em curso', preparing: 'Em processamento', busy: 'Em curso', mapping_pending: 'Confirmação em curso', baseline_initialized: 'Registo inicial criado', review_required: 'Precisa de atenção', source_invalid: 'Origem por confirmar', source_blocked: 'Origem por confirmar', mismatch: 'Diferença encontrada', catalog_mismatch: 'Diferença encontrada', check_failed: 'Verificação por concluir', check_deferred: 'Verificação adiada', deferred: 'Adiado', unknown: 'Resultado por confirmar', publish_unknown: 'Publicação por confirmar', import_unknown: 'Importação por confirmar', ready: 'Vídeo pronto', preview_ready: 'Vídeo pronto', expired: 'Story expirado', products_pending: 'Aprovação pendente', products_rejected: 'Artigos rejeitados', unverified: 'Por confirmar' };
  Object.assign(LABELS, { preserved: 'Publicações preservadas', daily_limit_reached: 'Limite diário atingido', other_cycle_in_progress: 'Outra atualização em curso', no_retirements: 'Sem retiradas pendentes', partial: 'Concluído parcialmente', failed: 'Operação não concluída', upload_unknown: 'Importação por confirmar' });
  const GOOD = new Set(['source_matches', 'catalog_matches', 'matched', 'synced', 'published', 'mapped', 'no_new_stock', 'retired', 'canceled', 'expired']);
  const ISSUES = new Set(['review_required', 'source_invalid', 'source_blocked', 'mismatch', 'catalog_mismatch', 'check_failed', 'unknown', 'publish_unknown', 'import_unknown', 'products_rejected']);
  GOOD.add('no_retirements'); GOOD.add('preserved'); for (const code of ['partial', 'failed', 'upload_unknown', 'unverified']) ISSUES.add(code);
  const ERRORS = { story_state_invalid: 'O histórico das Stories precisa de verificação. Não foi possível consultar o resultado.', story_provider_binding_changed: 'A ligação das Stories precisa de verificação.', morning_flow_unavailable: 'Não foi possível consultar esta execução.', catalog_permission_required: 'Falta acesso de servidor ao catálogo.' };
  let authenticated = false; let busy = false; let closing = false; let generation = 0; let followingToday = true;
  let manualRead = 0; let manualAction = ''; let submitting = false; let acceptedDay = '';
  let verifying = false, manualTitle = 'Atualizar tudo', manualRequest = null, dashboardRequest = null;
  let followRequest = false; let lastResume = 0;
  let manualInProgress = false; let manualPollingUntil = 0; let pollingManual = false; let lastDashboardRead = 0;
  let viewedCycle = null; let historyVersion = 0; let lastSearch = null;
  let editorialPost = null;
  let channelCheck = null, stockCheck = null, currentCycle = null, pendingManualStories = 0, calendarState = '';
  const fromShortcut = typeof location !== 'undefined' && location.hash === '#atalho';
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 5000 ? String(value) : '—';
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' });
  function lisbonDay(value) {
    const parts = Object.fromEntries(dayFormat.formatToParts(value).map(part => [part.type, part.value]));
    return [parts.year, parts.month, parts.day].join('-');
  }
  const today = () => lisbonDay(new Date());
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
  async function api(endpoint, options = {}, timeoutMs = 30000) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw Object.assign(new Error('Consulta indisponível'), { status: response.status, code: typeof data?.error === 'string' ? data.error : '' });
      return data;
    } finally { clearTimeout(timer); }
  }
  function sessionView(value, message = '') {
    authenticated = value; generation++;
    const expire = () => sessionView(false, 'A sessão terminou. Volta a entrar.');
    globalThis.AutoValorRoutineCalendar?.setSession(value, expire);
    globalThis.AutoValorWhatsappEditorial?.setSession(value, expire);
    globalThis.AutoValorExtraEditorial.setSession(value, expire, refreshAll);
    globalThis.AutoValorManualStories?.setSession(value, expire, pending => {
      pendingManualStories = pending;
      showCheckOverview();
    });
    $('dashboardView').hidden = !value; $('privateNav').hidden = !value; $('loginView').hidden = value;
    $('accessCode').value = ''; $('loginButton').disabled = false; text('loginStatus', message);
    if (!value) {
      channelCheck = null; stockCheck = null; currentCycle = null; pendingManualStories = 0; calendarState = '';
      viewedCycle = null; lastSearch = null; historyVersion++; followingToday = true;
      verifying = false; manualRequest = null; dashboardRequest = null; setBusy(false); text('checkStatus', '');
      $('stockActionDetails').open = false; text('manualHint', ''); text('checkDetails', '');
      manualRead++; manualAction = ''; acceptedDay = ''; submitting = false; followRequest = false; lastResume = 0;
      manualInProgress = false; manualPollingUntil = 0; lastDashboardRead = 0;
      $('runNow').disabled = true; text('runNow', 'Atualizar tudo'); text('manualStatus', ''); text('manualOutcome', '');
      badge('instagramBrief', 'Por consultar'); $('historyPanel').open = false;
      clearEditorial(); badge('editorialBadge', 'Por consultar'); $('editorialPanel').open = false; $('editorialHistoryPanel').open = false;
      for (const id of ['readAt', 'dashboardStatus', 'cycleSummary', 'cycleTime', 'latestCycle', 'catalogSummary', 'catalogTime', 'catalogAccess', 'photoSummary', 'storySummary', 'whatsappSummary', 'whatsappAccess', 'whatsappLast', 'whatsappTime', 'whatsappWithdrawal']) text(id, '');
      for (const id of ['sourceCount', 'feedCount', 'metaCount']) text(id, '—');
      badge('cycleBadge', 'Por consultar'); badge('catalogBadge', 'Por consultar'); badge('whatsappBadge', 'Por consultar'); $('stepsList').replaceChildren();
    }
  }
  function setBusy(value) { busy = value; for (const id of ['refreshButton', 'todayButton', 'cycleDay']) $(id).disabled = value; }
  const progressText = { source: 'A procurar viaturas nos dois inventários.', catalog: 'A sincronizar o catálogo da Meta.', retirements: 'A preservar o histórico do Instagram.', photo: 'A verificar a fotografia do Instagram.', story: 'A preparar o vídeo e o Story do Instagram.', verify: 'A confirmar os resultados.' };
  function showManualButton() {
    text('runNow', verifying ? 'A verificar…' : manualTitle);
    $('runNow').disabled = verifying || submitting || !manualAction;
  }
  function renderManual(data, message = '') {
    manualAction = 'verify';
    const state = data?.status;
    const wasInProgress = manualInProgress;
    manualInProgress = ['queued', 'running', 'already_started'].includes(state) || state === 'not_started' && acceptedDay === today();
    if (data?.stalled && state !== 'queued') manualInProgress = false;
    if (!manualInProgress) manualPollingUntil = 0;
    else if (!wasInProgress) manualPollingUntil = Date.now() + 15 * 60_000;
    const age = Date.now() - Date.parse(data?.startedAt);
    const idle = Date.now() - Date.parse(data?.updatedAt);
    const resumable = state === 'queued' && age >= 0 && age < 3600000 && (data.stalled || idle > 60000);
    let title = 'Verificar tudo';
    let hint = 'Não foi possível consultar a atualização. Toca no botão para verificar novamente.';
    let result = '';
    if (state === 'not_started' && acceptedDay !== today()) {
      manualAction = 'manual-start'; title = 'Atualizar tudo';
      hint = 'Stock, catálogo WhatsApp e Instagram, incluindo consulta das publicações criativas. Uma atualização extra por dia.';
    } else if (resumable) {
      manualAction = 'resume'; title = 'Continuar atualização';
      hint = 'O pedido ficou em fila. Podes continuar a partir da etapa onde parou.';
    } else if (state === 'blocked' || state === 'interrupted' || data?.stalled || state === 'queued' && age >= 3600000) {
      manualAction = 'refresh'; title = 'Verificar atualização';
      hint = 'A atualização não foi confirmada. O botão consulta o resultado sem repetir publicações.';
    } else if (['queued', 'running', 'already_started'].includes(state) || state === 'not_started' && acceptedDay === today()) {
      manualAction = 'refresh'; title = 'Ver progresso'; hint = progressText[data?.step] || 'Atualização em curso. O painel acompanha o progresso.';
    } else if (state === 'finished') {
      title = 'Verificar tudo';
      hint = 'A atualização extra de hoje terminou. Podes consultar o stock atual e os últimos resultados dos canais. Próxima rotina às 08h00.';
      const catalog = data.verification?.catalog;
      const confirmed = catalog?.catalogConfirmed === true && !catalog.active && !ISSUES.has(catalog.status);
      const detail = [['photo', 'Fotografia'], ['story', 'Story']].map(([key, name]) => {
        const value = data.results?.[key];
        const status = value?.ok === false && GOOD.has(value.status) ? 'Por confirmar' : value ? label(value) : 'Por confirmar';
        return name + ' · ' + status;
      });
      result = ['Catálogo · ' + (confirmed ? 'Confirmado na Meta' : 'Por confirmar'), ...detail].join('\n');
    } else if (state === 'production_only') {
      hint = 'A atualização só está disponível no painel de produção.';
    }
    manualTitle = title; showManualButton();
    const routineHint = state === 'finished' || manualAction === 'manual-start';
    text('manualHint', routineHint ? hint : '');
    text('manualStatus', message || (routineHint ? '' : hint));
    text('manualOutcome', result);
  }
  function readManualStatus() {
    if (manualRequest) return manualRequest;
    const request = ++manualRead;
    const version = generation;
    manualRequest = api(url('morning-flow', 'status') + '&mode=manual').then(data => {
      if (request !== manualRead || version !== generation) return false;
      if (stockCheck) stockCheck.manualMissing = false;
      renderManual(data); return true;
    }).catch(error => {
      if (request === manualRead && version === generation) {
        if (error.status === 401) sessionView(false, 'A sessão terminou. Volta a entrar.');
        else renderManual(null);
      }
      return false;
    }).finally(() => { if (request === manualRead) manualRequest = null; });
    return manualRequest;
  }
  async function refreshManual() {
    if (!authenticated || submitting) return;
    const version = generation;
    const success = await readManualStatus();
    if (success && version === generation && !verifying && (fromShortcut || followRequest) &&
        manualAction === 'resume' && Date.now() - lastResume > 90000) await submitManual();
  }
  function stockSummary(data) {
    const stands = ['Samucar', 'AutoValorPT'];
    if (data?.ok !== true || !Array.isArray(data.items) || !data.items.every(item =>
      Array.isArray(item?.sources) && item.sources.length && item.sources.every(name => stands.includes(name)))) {
      throw new Error('stock_unavailable');
    }
    const counts = stands.map(name => name + ' · ' + data.items.filter(item => item.sources.includes(name)).length);
    const total = data.items.length;
    return { total, detail: 'Stock atual: ' + total + (total === 1 ? ' viatura' : ' viaturas') + ' (' + counts.join(', ') + ').' };
  }
  function showCheckOverview() {
    if (!authenticated || verifying || !channelCheck) return;
    const current = stockCheck?.day === today() ? stockCheck : null;
    const alerts = [...channelCheck.alerts];
    if (current?.unavailable) alerts.unshift('Stock Standvirtual por consultar');
    if (current?.manualMissing) alerts.push('Atualização manual por consultar');
    if (pendingManualStories > 0) alerts.unshift(pendingManualStories === 1 ? 'Story manual por confirmar' : 'Stories manuais por confirmar');
    const newerDiagnostic = channelCheck.total != null && channelCheck.stamp > (current?.stockAt || 0);
    const total = current?.unavailable ? null : newerDiagnostic ? channelCheck.total : current?.total ?? channelCheck.total;
    if (!current?.unavailable && !newerDiagnostic && current?.total != null && channelCheck.total != null &&
        current.total !== channelCheck.total && !alerts.some(item => item.startsWith('Catálogo WhatsApp')))
      alerts.push('Contagem do catálogo WhatsApp por atualizar');
    if (total == null && !current?.unavailable && !alerts.length) alerts.push('Stock por verificar');
    const line = total == null ? [] : [total + (total === 1 ? ' viatura' : ' viaturas')];
    if (alerts.length) line.push(...new Set(alerts));
    else line.push('Verificação concluída');
    if (current?.time) line.push(current.time);
    const element = $('checkStatus');
    element.className = 'status' + (alerts.length ? ' attention' : '');
    text('checkStatus', line.join(' · '));
  }
  function publicationAttention(name, data) {
    if (!data || data.ok === false) return name + ' por consultar';
    if (data.authorization?.expired || data.authorization?.lastError) return name + ' com acesso por renovar';
    if (data.active) return name + (/unknown|review|required/.test(data.active.phase || '') ? ' por confirmar' : ' em curso');
    if (data.configuration?.enabled !== true) return name + ' por ativar';
    const result = data.lastResult;
    if (result?.ok !== false && ['published', 'mapped', 'no_new_stock', 'expired', 'daily_limit_reached'].includes(result?.status)) return '';
    return name + ' por confirmar';
  }
  function updateCheckOverview({ catalog, photos, stories, editorial, whatsapp, cycle, cycleError }) {
    const alerts = [];
    const diagnostic = catalog?.lastResult;
    const stamp = Date.parse(diagnostic?.checkedAt || diagnostic?.at);
    const currentDiagnostic = Number.isFinite(stamp) && lisbonDay(new Date(stamp)) === today();
    const total = currentDiagnostic && !catalog.active && (diagnostic.sourceValid || diagnostic.catalogConfirmed) &&
      Number.isSafeInteger(diagnostic.sourceCount) && diagnostic.sourceCount >= 0 ? diagnostic.sourceCount : null;
    alerts.push(publicationAttention('Story', stories), publicationAttention('Fotografia', photos));
    if (!catalog || catalog.ok === false) alerts.push('Catálogo WhatsApp por consultar');
    else if (catalog.active || diagnostic?.catalogConfirmed !== true || diagnostic?.ok === false) alerts.push('Catálogo WhatsApp por confirmar');
    const wa = whatsapp?.active;
    if (!whatsapp || whatsapp.ok === false) alerts.push('Estado WhatsApp por consultar');
    else if (wa || whatsapp.blocked || !whatsapp.device?.valid ||
        ['closed_without_publication_confirmation', 'unknown'].includes(whatsapp.lastResult?.status))
      alerts.push('Estado WhatsApp por confirmar');
    if (!editorial || editorial.ok === false) alerts.push('Publicações criativas por consultar');
    else if ($('editorialBadge').className !== 'badge good') alerts.push('Publicações criativas · ' + $('editorialBadge').textContent.toLowerCase());
    if (cycleError || cycle?.ok === false) alerts.push('Rotina das 08h00 por consultar');
    else if (cycle?.stalled || ['blocked', 'interrupted'].includes(cycle?.status) || cycle?.status === 'finished' && !cycle.verification)
      alerts.push('Rotina das 08h00 por confirmar');
    else if (cycle?.status === 'not_started' &&
        Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) >= 8)
      alerts.push('Rotina das 08h00 sem registo');
    if (cycle?.status === 'finished') {
      for (const name of finalIssues(cycle)) {
        const service = { 'Stories': stories, fotografias: photos, 'catálogo': catalog }[name];
        // A later successful channel check supersedes a morning report.
        const latest = Date.parse(service?.lastResult?.checkedAt || service?.lastResult?.at);
        if (Number.isFinite(latest) && latest > Date.parse(cycle.updatedAt)) continue;
        const topic = { Stories: 'Story', fotografias: 'Fotografia', 'catálogo': 'Catálogo WhatsApp' }[name];
        if (topic && !alerts.some(item => item.startsWith(topic))) alerts.push(topic + ' por confirmar');
      }
    }
    channelCheck = { total, stamp, alerts: alerts.filter(Boolean) };
    showCheckOverview();
  }
  async function verifyPanel(checkStock) {
    if (verifying) return;
    const version = generation;
    verifying = true; showManualButton(); text('checkDetails', '');
    $('checkStatus').className = 'status';
    text('checkStatus', checkStock ? 'A consultar os dois inventários e os registos dos canais…' : 'A consultar o progresso da atualização…');
    try {
      const stock = checkStock ? api(url('instagram-sync', 'stories-manual-stock')).then(stockSummary) : null;
      const [manual, channels, inventory] = await Promise.allSettled([readManualStatus(), refresh(), stock]);
      if (version !== generation) return;
      if (inventory.status === 'rejected' && inventory.reason?.status === 401) {
        sessionView(false, 'A sessão terminou. Volta a entrar.'); return;
      }
      if (channels.status !== 'fulfilled' || !Array.isArray(channels.value)) channelCheck = { total: null, alerts: ['Registos dos canais por consultar'] };
      const time = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', timeStyle: 'medium' }).format(new Date());
      const prior = stockCheck?.day === today() ? stockCheck : null;
      stockCheck = { ...prior, day: today(), time, manualMissing: manual.status !== 'fulfilled' || !manual.value };
      if (checkStock) {
        stockCheck.stockAt = Date.now();
        stockCheck.unavailable = inventory.status !== 'fulfilled';
        stockCheck.total = stockCheck.unavailable ? null : inventory.value.total;
        stockCheck.detail = stockCheck.unavailable ? '' : inventory.value.detail;
      }
      text('checkDetails', stockCheck.detail || '');
    } finally { if (version === generation) { verifying = false; showManualButton(); showCheckOverview(); } }
  }
  async function submitManual() {
    if (!authenticated || submitting || !manualAction || $('runNow').disabled) return;
    const version = generation;
    const action = manualAction;
    if (action === 'verify' || action === 'refresh') { await verifyPanel(action === 'verify'); return; }
    manualRead++; manualRequest = null; stockCheck = null; text('checkStatus', ''); text('checkDetails', ''); manualAction = ''; submitting = true; $('runNow').disabled = true;
    if (action === 'resume') lastResume = Date.now();
    text('manualStatus', action === 'resume' ? 'A retomar o pedido…' : 'A registar o pedido…');
    try {
      const endpoint = url('morning-flow', action) + (action === 'resume' ? '&mode=manual' : '');
      const result = await api(endpoint, { method: 'POST' });
      if (version !== generation) return;
      if (['queued', 'running', 'finished', 'already_started', 'blocked', 'interrupted'].includes(result.status)) {
        acceptedDay = validDay(result.day) ? result.day : today();
        followRequest = true;
      }
      renderManual(result);
    } catch (error) {
      if (version !== generation) return;
      if (error.status === 401) { sessionView(false, 'A sessão terminou. Volta a entrar.'); return; }
      followRequest = false;
      renderManual(null, 'Pedido por confirmar. Toca em «Verificar tudo» para saber se chegou ao servidor.');
      return;
    } finally { if (version === generation) { submitting = false; $('runNow').disabled = !manualAction; } }
    if (authenticated) await refreshAll();
  }
  function showCycle(data, error) {
    const list = $('stepsList'); list.replaceChildren();
    const verificationIssues = error ? [] : finalIssues(data);
    if (error) { badge('cycleBadge', 'Leitura indisponível', 'error'); text('cycleSummary', errorText(error)); text('cycleTime', ''); }
    else {
      const pending = verificationIssues.length > 0 || STEPS.some(([key]) => { const r = data.results?.[key]; return !r || r.ok === false || r.remaining > 0 || !GOOD.has(r.status) && !(r.status === 'checked' && r.catalogConfirmed === true); });
      const title = data.stalled ? 'Execução sem avanço confirmado' : ({ not_started: 'Ainda não iniciada', queued: 'Próxima etapa em fila', running: 'Em execução', finished: pending ? 'Terminada com pendências' : 'Etapas do servidor terminadas', blocked: 'Execução bloqueada', interrupted: 'Execução interrompida', production_only: 'Disponível em produção' }[data.status] || 'Resultado por confirmar');
      badge('cycleBadge', title, ['blocked', 'interrupted'].includes(data.status) || data.stalled ? 'error' : 'pending');
      text('cycleSummary', data.status === 'not_started' ? 'Não há uma execução registada para este dia. O horário previsto não comprova que a rotina tenha começado.' : data.status === 'finished' ? 'Consulte o resultado de cada etapa. Os Estados WhatsApp são acompanhados separadamente.' : data.stalled ? 'É necessário confirmar a operação antes de repetir qualquer publicação.' : `Dia da execução: ${data.day || $('cycleDay').value}.`);
      if (data.status === 'finished' && !pending) badge('cycleBadge', title, 'good');
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
    const unconfirmedMatch = ['catalog_matches', 'matched', 'synced'].includes(r.status) && r.catalogConfirmed !== true;
    badge('catalogBadge', error ? 'Leitura indisponível' : active ? 'Operação por confirmar' : r.catalogConfirmed === true ? 'Dados conferidos na Meta' : unconfirmedMatch ? 'Catálogo por confirmar' : label(r), error ? 'error' : active ? 'pending' : r.catalogConfirmed === true ? 'good' : ISSUES.has(r.status) ? 'error' : 'pending');
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
      for (const id of ['whatsappAccess', 'whatsappLast', 'whatsappTime', 'whatsappWithdrawal']) text(id, '');
      return;
    }
    const device = data?.device; const active = data?.active; const last = data?.lastResult; const removal = data?.lastWithdrawalResult;
    const observed = last?.status === 'observed_published';
    const closed = last?.status === 'closed_without_publication_confirmation';
    const vehicle = /^ID[A-Za-z0-9]{5,30}$/.test(last?.id || '') ? last.id : 'Viatura';
    let title = 'Ainda sem publicação observada'; let stateKind = 'pending';
    if (active || data?.blocked) {
      title = active?.kind === 'withdrawal' ? ({ reserved: 'Retirada reservada', deleting: 'Eliminação por confirmar', unknown: 'Retirada incerta — não repetir' }[active.phase] || 'Retirada por concluir') : ({ reserved: 'Vídeo reservado', publishing: 'Publicação por confirmar', unknown: 'Resultado incerto — não repetir' }[active?.phase] || 'Tentativa por concluir');
      if (active?.phase === 'unknown') stateKind = 'error';
    } else if (!device) title = 'Dispositivo por autorizar';
    else if (!device.valid) { title = device.revokedAt ? 'Acesso aos vídeos revogado' : 'Acesso aos vídeos expirado ou inválido'; stateKind = 'error'; }
    else if (removal?.status === 'observed_removed') { title = 'Eliminação observada'; stateKind = 'good'; }
    else if (removal?.status === 'closed_without_removal_confirmation') title = 'Retirada encerrada sem confirmação';
    else if (observed) { title = 'Última publicação observada'; stateKind = 'good'; }
    else if (closed) title = 'Tentativa encerrada sem confirmação';
    badge('whatsappBadge', title, stateKind);
    text('whatsappSummary', 'A aplicação prepara o conteúdo. O envio e a verificação em «O meu estado» são feitos no WhatsApp Business.');
    text('whatsappAccess', !device ? 'Ainda não existe autorização desta aplicação para obter os vídeos.' : device.revokedAt ? `Acesso aos vídeos revogado em ${date(device.revokedAt)}. Isto não termina a sessão no WhatsApp.` : device.valid ? `Acesso aos vídeos válido até ${date(device.expiresAt)}. A sessão ligada no WhatsApp é verificada separadamente.` : `Acesso aos vídeos expirado ou invalidado. Validade registada: ${date(device.expiresAt)}.`);
    text('whatsappLast', observed ? `${vehicle}: publicação observada ${last.confirmationSource === 'whatsapp_observation' ? 'em «O meu estado»' : 'no WhatsApp Web'}.${typeof last.observation === 'string' ? ` ${last.observation.slice(0, 300)}` : ''} Não é uma confirmação da API da Meta.` : closed ? `${vehicle}: tentativa encerrada sem confirmação de publicação. Este carro não será repetido automaticamente.` : 'Ainda não existe uma publicação observada neste registo.');
    text('whatsappWithdrawal', removal?.status === 'observed_removed' ? `Eliminação de ${/^ID[A-Za-z0-9]{5,30}$/.test(removal.id || '') ? removal.id : 'viatura'} observada em ${date(removal.observedAt)}.${typeof removal.observation === 'string' ? ` ${removal.observation.slice(0, 300)}` : ''} Não é uma confirmação da API da Meta.` : removal?.status === 'closed_without_removal_confirmation' ? `Retirada encerrada sem confirmação de eliminação em ${date(removal.at)}. Não será repetida automaticamente.` : 'Ainda sem eliminação observada. O fim da janela de 24 horas não comprova uma eliminação.');
    text('whatsappTime', active?.startedAt ? `Tentativa atual: ${date(active.startedAt)}.${last?.observedAt || last?.at ? ` Último registo: ${date(last.observedAt || last.at)}.` : ''}` : last?.observedAt || last?.at ? `Último registo: ${date(last.observedAt || last.at)}.` : '');
  }
  async function loadHistory() {
    if (!authenticated || !$('historyPanel').open || !viewedCycle) return;
    const { day, current } = viewedCycle;
    const currentDay = today();
    if (day !== currentDay || !current || current.startedAt) {
      text('latestCycle', day !== currentDay ? 'Os outros resultados mostram a verificação mais recente de cada canal.'
        : current?.startedAt ? 'Última execução encontrada: ' + date(current.startedAt) + '.' : 'Última execução por confirmar.');
      return;
    }
    if (lastSearch?.day === day) { text('latestCycle', lastSearch.message); return; }
    const version = ++historyVersion;
    const session = generation;
    const relevant = () => session === generation && version === historyVersion && viewedCycle?.day === day && $('historyPanel').open;
    let message = 'A procurar a última execução…';
    lastSearch = { day, message }; text('latestCycle', message);
    try {
      message = 'Sem execução registada nos últimos sete dias.';
      for (let offset = 1; offset <= 7; offset++) {
        const prior = new Date(day + 'T12:00:00Z'); prior.setUTCDate(prior.getUTCDate() - offset);
        const previousDay = prior.toISOString().slice(0, 10);
        const previous = await api(url('morning-flow', 'status', previousDay));
        if (!relevant()) return;
        if (previous.startedAt) { message = 'Última execução encontrada: ' + date(previous.startedAt) + '. Escolhe ' + previousDay + ' para ver as etapas.'; break; }
      }
      lastSearch = { day, message }; text('latestCycle', message);
    } catch (error) {
      if (!relevant()) return;
      lastSearch = null;
      if (error.status === 401) sessionView(false, 'A sessão terminou. Volta a entrar.');
      else text('latestCycle', 'A procura do último dia ficou indisponível. Podes voltar a consultar.');
    }
  }
  function showInstagram(photos, stories, photoError, storyError) {
    const services = [photos, stories];
    if (photoError || storyError) { badge('instagramBrief', 'Leitura incompleta', 'error'); return; }
    if (services.some(s => s?.authorization?.expired || s?.authorization?.lastError)) { badge('instagramBrief', 'Rever acesso ao Instagram', 'error'); return; }
    if (services.some(s => s?.active)) { badge('instagramBrief', 'Publicação em curso'); return; }
    if (services.some(s => ISSUES.has(s?.lastResult?.status) || s?.lastResult?.ok === false && !GOOD.has(s?.lastResult?.status))) {
      badge('instagramBrief', 'Verificar publicações', 'error'); return;
    }
    const short = s => s?.configuration?.enabled !== true ? 'por configurar'
      : ['published', 'mapped'].includes(s?.lastResult?.status) ? 'publicada'
      : s?.lastResult?.status === 'no_new_stock' ? 'sem novidades' : s?.lastResult ? label(s.lastResult).toLowerCase() : 'por confirmar';
    const confirmed = services.every(s => s?.configuration?.enabled === true && ['published', 'mapped', 'no_new_stock'].includes(s?.lastResult?.status));
    badge('instagramBrief', 'Foto ' + short(photos) + ' · Story ' + short(stories), confirmed ? 'good' : 'pending');
  }

  function clearEditorial() {
    renderPreviewLinks();
    editorialPost = null; globalThis.AutoValorExtraEditorial.setStatus(null);
    for (const id of ['editorialSchedule','editorialResult','editorialTitle','editorialDate','editorialCaption','editorialPreviewNote']) text(id, '');
    $('editorialNext').hidden = true; $('editorialImage').hidden = true;
    $('editorialImage').removeAttribute('src'); $('editorialImage').alt = '';
    $('editorialHistory').replaceChildren();
  }
  function postLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
      if (!/^\/(?:autovalorpt\/)?(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
      url.search = ''; url.hash = ''; return url.href;
    } catch { return null; }
  }


  function editorialImageUrl(post) {
    if (!validDay(post?.date) || post?.format === 'REELS' || !Number.isSafeInteger(post?.slideCount) || post.slideCount < 1 || post.slideCount > 10) return null;
    return imageUrl(post, 0);
  }
  function loadEditorialPreview() {
    if (!authenticated || !$('editorialPanel').open) return;
    const src = editorialImageUrl(editorialPost); const image = $('editorialImage');
    if (!src) return;
    if (image.getAttribute('src') !== src) image.src = src;
    image.alt = typeof editorialPost.title === 'string' ? editorialPost.title : 'Conteúdo AutoValorPT';
    image.hidden = false;
  }
  function editorialResultLabel(result) {
    return ({published:'Publicação confirmada',already_published:'Publicação já confirmada',not_due:'A aguardar o horário',before_start:'A aguardar o início',disabled:'Rotina pausada',paused:'Rotina pausada',publishing:'A confirmar publicação',failed:'Publicação não concluída',authorization_required:'Ligação por verificar'})[result?.status] || label(result);
  }
  function showEditorial(data, error) {
    if (!error && data?.ok !== false && data) {
      const revision = [data.enabled, data.nextPost?.id, data.nextPost?.date, data.lastResult?.at, data.active?.phase].join('|');
      if (calendarState && revision !== calendarState) globalThis.AutoValorRoutineCalendar?.invalidate();
      calendarState = revision;
    }
    if (error || !data || data.ok === false) {
      clearEditorial(); badge('editorialBadge','Leitura indisponível','error'); text('editorialResult','Não foi possível consultar as publicações criativas.'); return;
    }
    const config = data.configuration || {}; const auth = data.authorization || {};
    const configured = config.tokenConfigured === true && config.accountConfigured === true && config.validApi === true && config.imagesConfigured === true && config.production !== false;
    const last = data.lastResult;
    globalThis.AutoValorExtraEditorial.setStatus(data);
    if (data.active) {
      const uncertain = /unknown|uncertain/.test(data.active.phase || '');
      badge('editorialBadge', uncertain ? 'Publicação por confirmar' : 'Publicação em curso', uncertain ? 'error' : 'pending');
    } else if (auth.expired || auth.lastError || !configured || ['publish_unknown','unknown','review_required','failed','authorization_required'].includes(last?.status)) {
      badge('editorialBadge','Precisa de atenção','error');
    } else if (data.enabled === false) badge('editorialBadge','Rotina pausada','pending');
    else if (data.enabled === true) badge('editorialBadge','Rotina ativa · 19h00','good');
    else badge('editorialBadge','Rotina por confirmar','pending');
    text('editorialSchedule', data.enabled === false ? 'Rotina pausada.' : data.enabled === true && data.schedule?.nextRunAt ? 'Próxima publicação prevista: ' + date(data.schedule.nextRunAt) + '.' : 'Próxima publicação por confirmar.');
    text('editorialResult', data.active ? 'Existe uma tentativa em curso ou por confirmar. Não repetir.' : last ? 'Último resultado: ' + editorialResultLabel(last) + (last.at ? ' · ' + date(last.at) : '') + '.' : 'Ainda sem publicação registada.');
    const post = data.nextPost;
    const valid = validDay(post?.date) && (post.format === 'REELS' || Number.isSafeInteger(post.slideCount) && post.slideCount >= 1 && post.slideCount <= 10);
    editorialPost = valid ? post : null;
    globalThis.AutoValorRoutineCalendar?.setNextPost(editorialPost);
    renderPreviewLinks(editorialPost);
    $('editorialNext').hidden = !valid;
    const image = $('editorialImage'); const src = editorialImageUrl(editorialPost);
    if (!src || image.getAttribute('src') !== src) { image.removeAttribute('src'); image.hidden = true; image.alt = ''; }
    text('editorialTitle', valid && typeof post.title === 'string' ? post.title : 'Conteúdo por confirmar');
    const previewDay = valid ? new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'medium' }).format(new Date(post.date + 'T12:00:00Z')) : '';
    text('editorialDate', !valid ? '' : post.provisional === true ? 'Previsto para ' + previewDay +
      '. As fontes e a legenda serão preparadas mais perto da publicação.' : 'Preparado para ' + previewDay + '.');
    text('editorialCaption', valid && typeof post.caption === 'string' ? post.caption : '');
    text('editorialPreviewNote', !valid ? '' : post.format === 'REELS' ? 'Reel preparado. Abre a pré-visualização completa para ver o vídeo.' : post.slideCount > 1 ? 'Primeira imagem do carrossel. Abre a pré-visualização completa para ver todas.' : '');
    loadEditorialPreview();
    const history = $('editorialHistory'); history.replaceChildren();
    const rows = Array.isArray(data.history) ? data.history.slice(0,14) : [];
    if (!rows.length) history.appendChild(node('li','Ainda sem histórico consultado.'));
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const item = node('li',''); item.appendChild(node('small',(validDay(row.date) ? row.date : date(row.at)) + (row.extra === true ? ' · Extra' : '')));
      item.appendChild(node('strong',typeof row.title === 'string' ? row.title : 'Conteúdo AutoValorPT'));
      const published = ['published','already_published'].includes(row.status);
      item.appendChild(node('span',editorialResultLabel(row),'badge ' + (published ? 'good' : ISSUES.has(row.status) ? 'error' : 'pending')));
      const link = published ? postLink(row.permalink) : null;
      if (link) { const a = node('a','Ver publicação'); a.href=link; a.target='_blank'; a.rel='noopener noreferrer'; item.appendChild(a); }
      appendHistoryCaptions(item, row);
      history.appendChild(item);
    }
  }
  function refresh() {
    if (!authenticated) return;
    if (dashboardRequest) return dashboardRequest;
    const version = generation;
    dashboardRequest = readDashboard().finally(() => {
      if (version === generation) { dashboardRequest = null; setBusy(false); }
    });
    return dashboardRequest;
  }
  async function readDashboard() {
    $('cycleDay').max = today(); if (followingToday) $('cycleDay').value = today();
    const day = $('cycleDay').value; if (!validDay(day)) return;
    setBusy(true); lastDashboardRead = Date.now(); const version = generation; text('dashboardStatus', 'A consultar os registos…');
    const results = await Promise.allSettled([api(url('morning-flow', 'status', day)), api(url('meta-catalog', 'status')), api(url('instagram-sync', 'status')), api(url('instagram-sync', 'stories-status')), api(url('whatsapp-status', 'status')), api(url('editorial', 'status'))]);
    if (version !== generation) return;
    if (results.some(r => r.status === 'rejected' && r.reason.status === 401)) { sessionView(false, 'A sessão terminou. Volte a entrar para consultar os resultados.'); return; }
    const value = index => results[index].status === 'fulfilled' ? results[index].value : null;
    const error = index => results[index].status === 'rejected' ? results[index].reason : null;
    showCycle(value(0), error(0)); showCatalog(value(1), error(1)); showPublication('photoSummary', 'Fotografias', value(2), error(2)); showPublication('storySummary', 'Stories', value(3), error(3)); showWhatsapp(value(4), error(4));
    showInstagram(value(2), value(3), error(2), error(3)); showEditorial(value(5), error(5));
    const currentDay = today();
    if (day === currentDay) currentCycle = { day, value: value(0), error: error(0) };
    updateCheckOverview({ catalog: value(1), photos: value(2), stories: value(3), whatsapp: value(4), editorial: value(5),
      cycle: currentCycle?.day === currentDay ? currentCycle.value : null,
      cycleError: currentCycle?.day !== currentDay || currentCycle.error });
    text('readAt', 'Consulta de ' + date(new Date().toISOString()) + '.');
    text('dashboardStatus', results.some(r => r.status === 'rejected') ? 'Alguns registos não puderam ser consultados. Os resultados indisponíveis estão identificados abaixo.' : '');
    if (!viewedCycle || viewedCycle.day !== day || viewedCycle.current?.startedAt !== value(0)?.startedAt) {
      historyVersion++; lastSearch = null; text('latestCycle', '');
    }
    viewedCycle = { day, current: value(0) };
    void loadHistory();
    const sections = ['rotina das 08h00', 'catálogo WhatsApp', 'fotografias do Instagram', 'Stories do Instagram', 'Estado WhatsApp', 'publicações criativas'];
    return sections.filter((_, index) => error(index));
  }
  function refreshAll() { return Promise.all([refreshManual(), refresh()]); }
  $('runNow').addEventListener('click', submitManual);
  $('editorialPanel').addEventListener('toggle', loadEditorialPreview);
  $('historyPanel').addEventListener('toggle', () => {
    if ($('historyPanel').open) void loadHistory();
    else { historyVersion++; lastSearch = null; }
  });
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const access = $('accessCode').value.trim(); if (!access) return;
    $('loginButton').disabled = true; text('loginStatus', 'A verificar o acesso…');
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) }); sessionView(true); await refreshAll(); }
    catch (error) { $('accessCode').value = ''; text('loginStatus', error.status === 401 ? 'Código de acesso inválido.' : error.status === 429 ? 'Demasiadas tentativas. Aguarde antes de voltar a tentar.' : 'Não foi possível entrar. Tente novamente.'); }
    finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (closing) return; closing = true; $('logoutButton').disabled = true;
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); sessionView(false, 'Sessão terminada.'); }
    catch { text('dashboardStatus', 'Não foi possível terminar a sessão. Tente novamente.'); }
    finally { closing = false; $('logoutButton').disabled = false; }
  });
  $('refreshButton').addEventListener('click', refreshAll);
  $('cycleDay').value = today(); $('cycleDay').max = today();
  $('cycleDay').addEventListener('change', () => { followingToday = false; refresh(); });
  $('todayButton').addEventListener('click', () => { followingToday = true; refresh(); });
  // Idle dashboards never poll Blob: each channel is read on explicit request,
  // initial load, or return to the page after a one-minute cooldown.
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden && authenticated && Date.now() - lastDashboardRead >= 60_000) void refreshAll();
  });
  // Only an active manual cycle is followed, with a bounded read budget.
  // The scheduled routine continues on the server independently of the panel.
  async function pollActive() {
    if (document.hidden || !authenticated || !manualInProgress || Date.now() >= manualPollingUntil || pollingManual || submitting || busy) return;
    pollingManual = true;
    const version = generation;
    try {
      await refreshManual();
      if (authenticated && generation === version && !manualInProgress) await refresh();
    } finally { pollingManual = false; }
  }
  setInterval(() => { void pollActive(); }, 60_000);
  api('/api/admin-session').then(async session => {
    sessionView(session.authenticated === true, session.configured === false ? 'O acesso privado ainda está a ser configurado.' : '');
    if (session.configured === false) $('loginButton').disabled = true;
    if (authenticated) await refreshAll();
  }).catch(() => sessionView(false, 'Não foi possível verificar a sessão. Tente entrar novamente.'));
})();
