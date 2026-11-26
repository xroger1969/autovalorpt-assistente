(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ID = /^ID[A-Za-z0-9]{5,30}$/;
  const LABELS = { baseline: 'Registo inicial', queued: 'Em fila', ready: 'Vídeo pronto', preview_ready: 'Pré-visualização pronta', preview_failed: 'Pré-visualização não concluída', published: 'Story publicado', mapping_pending: 'Publicado; confirmação em curso', mapped: 'Publicação confirmada', canceled: 'Cancelado', retired: 'Story retirado', expired: 'Story expirado', failed: 'Operação não concluída', unknown: 'Resultado por confirmar' };
  const STOCK_CHANGED = new Set(['stock_source_changed','stock_not_synchronized']);
  const REASONS = { stock_source_changed: 'O stock do Standvirtual mudou desde a última sincronização. Volta ao painel principal e carrega em «Atualizar tudo» antes de verificar a ligação.', stock_not_synchronized: 'O stock ainda não está sincronizado. Volta ao painel principal e carrega em «Atualizar tudo».', facebook_authorization_required: 'Falta concluir a autorização Meta.', story_permissions_required: 'A autorização Meta precisa de permissões adicionais.', instagram_business_account_required: 'A conta tem de ser uma conta empresarial do Instagram.', story_publishing_limit_reached: 'O limite de publicações da conta foi atingido.', story_test_requires_latest_publication: 'A viatura já não é elegível. Verifique novamente a ligação e a disponibilidade.', story_already_processed: 'Esta viatura já foi processada. Atualize o estado.', video_signing_not_configured: 'A disponibilização do vídeo ainda não está configurada.', wrong_story_account: 'A conta ligada não corresponde a @autovalorpt.', story_provider_rejected: 'O Instagram ou a Meta recusou o pedido. Consulte o estado antes de repetir.', story_binding_changed: 'A configuração do registo mudou e precisa de verificação.' };
  let version = 0, fullHistory = false, resumeTarget = null;
  const model = { status: null, verification: null, busy: false };

  function message(id, text = '', kind = '') {
    const el = $(id);
    el.textContent = text;
    el.className = `status${id === 'dashboardStatus' ? ' notice' : ''}${kind ? ` ${kind}` : ''}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }
  function date(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(d);
  }
  function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
  function apiUrl(action, key, id) {
    const q = new URLSearchParams({ integration: 'instagram-sync', action });
    if (key && ID.test(id)) q.set(key, id);
    return `/api/stock?${q}`;
  }
  async function api(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        const error = new Error(response.status === 401 ? 'A sessão terminou. Volte a entrar.' : response.status === 429 ? 'Demasiadas tentativas. Aguarde antes de voltar a tentar.' : REASONS[data?.error] || 'Não foi possível concluir o pedido. Consulte o estado antes de repetir.');
        error.status = response.status; error.data = data; throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('O pedido ficou sem resposta. Pode continuar em processamento. Atualize o estado antes de repetir.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function mediaUrl(value, id) {
    try {
      if (!value) return '';
      const url = new URL(value, location.origin);
      return url.origin === location.origin && url.pathname === '/api/stock' && url.searchParams.get('integration') === 'instagram-video' && url.searchParams.get('id') === id && !url.username && !url.password && !url.hash ? url.href : '';
    } catch { return ''; }
  }
  function storyUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname) && /^\/stories\/autovalorpt\/\d+\/?$/.test(u.pathname) && !u.username && !u.password && !u.port && !u.search && !u.hash ? u.href : ''; } catch { return ''; }
  }
  function entries() { return Array.isArray(model.status?.items) ? model.status.items.filter((item) => ID.test(item.id)) : []; }
  function preparingAttempt() {
    const active = model.status?.active;
    const start = Date.parse(active?.startedAt || '');
    const item = entries().find(entry => entry.id === active?.id && entry.status === 'ready');
    if (!item || active.phase !== 'preparing' || !/^[a-f0-9-]{36}$/i.test(active.attemptId) ||
        !Number.isFinite(start) || Date.now() - start < 6 * 60000) return null;
    const url = mediaUrl(item.videoUrl, item.id);
    return url ? { id: item.id, attemptId: active.attemptId, url } : null;
  }
  function render() {
    const c = model.status?.configuration;
    $('accountName').textContent = c?.username === 'autovalorpt' ? '@autovalorpt' : 'Por confirmar';
    $('enabledState').textContent = c ? (c.enabled ? 'Ativa' : 'Desativada') : 'Por confirmar';
    $('connectionState').textContent = model.verification ? (model.verification.authorization?.ready ? 'Verificada' : 'Por concluir') : 'Por verificar';
    $('refreshButton').disabled = model.busy; $('verifyButton').disabled = model.busy; $('logoutButton').disabled = model.busy;
    $('activeStatus').textContent = model.status?.active ? `Operação em curso: ${model.status.active.id} · iniciada em ${date(model.status.active.startedAt)}. Aguarde e atualize o estado.` : 'Nenhuma operação em curso no último estado consultado.';
    const list = $('historyList'); list.replaceChildren();
    const history = entries().filter((entry) => entry.status !== 'baseline').sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const recent = fullHistory ? history : history.slice(0, 10);
    $('moreHistory').hidden = fullHistory || history.length <= recent.length;
    if (!recent.length) list.appendChild(node('li', 'Ainda não existem operações de vídeo registadas.'));
    for (const entry of recent) {
      const li = node('li', `${entry.id} · ${LABELS[entry.status] || 'Estado por confirmar'}`);
      li.appendChild(node('small', date(entry.at)));
      if (/^\d{5,30}$/.test(String(entry.instagramMediaId || ''))) li.appendChild(node('small', `Publicação Instagram: ${entry.instagramMediaId}`));
      const href = storyUrl(entry.permalink);
      if (href) { const a = node('a', 'Ver Story no Instagram'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.appendChild(a); }
      const media = mediaUrl(entry.videoUrl, entry.id);
      if (media) {
        const link = node('a', 'Ver MP4 guardado');
        link.href = media; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.appendChild(link);
        const review = node('button', 'Rever vídeo com os dados atuais');
        review.type = 'button'; review.className = 'ms-action';
        review.addEventListener('click', () => globalThis.AutoValorManualStories.selectAvailable(entry.id));
        li.appendChild(review);
      }
      list.appendChild(li);
    }
    const active = preparingAttempt();
    $('resumeLegacy').hidden = !active;
    $('resumeLegacyButton').disabled = model.busy || !active;
    const player = $('legacyVideo');
    if (active) {
      $('legacyVehicle').textContent = 'Revê o vídeo da viatura ' + active.id + ' antes de continuar o mesmo envio.';
      if (player.src !== active.url) player.src = active.url;
    } else if (player.hasAttribute('src')) { player.pause(); player.removeAttribute('src'); player.load(); }
  }
  function showLogin(text = '', kind = '', { preserveRecovery = true } = {}) {
    version += 1; fullHistory = false; resumeTarget = null;
    if ($('resumeDialog').open) $('resumeDialog').close();
    message('resumeStatus');
    Object.assign(model, { status: null, verification: null, busy: false });
    globalThis.AutoValorManualStories?.setSession(false, undefined, undefined, { preserveRecovery });
    render();
    $('historyList').replaceChildren(); $('stockRecovery').hidden = true;
    $('technicalDetails').open = false;
    message('verificationStatus'); message('dashboardStatus');
    $('dashboardView').hidden = true; $('privateNav').hidden = true; $('loginView').hidden = false; $('loginButton').disabled = false;
    message('loginStatus', text, kind);
  }
  function showDashboard() { globalThis.AutoValorManualStories?.setSession(true, () => showLogin('A sessão terminou. Volta a entrar.')); $('accessCode').value = ''; $('loginView').hidden = true; $('dashboardView').hidden = false; $('privateNav').hidden = false; }
  function handleError(error, target = 'dashboardStatus') {
    if (error.status === 401) { showLogin(error.message); return; }
    if (STOCK_CHANGED.has(error.data?.error)) {
      model.verification = null; $('stockRecovery').hidden = false;
      message('verificationStatus', REASONS[error.data.error], 'error');
    }
    message(target, error.message || 'Não foi possível concluir o pedido. Atualize o estado antes de repetir.', 'error');
  }
  async function refreshStatus() {
    if (model.busy) return;
    model.busy = true; render(); message('dashboardStatus', 'A consultar o estado…'); const v = version;
    try {
      const data = await api(apiUrl('stories-status'));
      if (v !== version) return;
      if (data.ok === false) throw new Error('O estado não ficou confirmado. Não repita uma publicação sem confirmação.');
      model.status = data;
      message('dashboardStatus', `Estado atualizado em ${date(new Date().toISOString())}.`);
    } catch (error) { if (v === version) handleError(error); }
    finally { if (v === version) { model.busy = false; render(); } }
  }
  async function verifyConnection() {
    if (model.busy) return;
    model.busy = true; model.verification = null; $('stockRecovery').hidden = true; render(); message('verificationStatus', 'A verificar a conta e a autorização…'); const v = version;
    try {
      const data = await api(apiUrl('stories-dry-run'), {}, 90000);
      if (v !== version) return;
      model.status = data; model.verification = data;
      const ready = data.ok !== false && data.authorization?.ready === true;
      message('verificationStatus', ready ? 'Conta @autovalorpt e ligação verificadas.' : REASONS[data.authorization?.reason] || 'A ligação ainda não está pronta para publicar.', ready ? 'success' : 'error');
    } catch (error) { if (v === version) handleError(error, 'verificationStatus'); }
    finally { if (v === version) { model.busy = false; render(); } }
  }
  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const access = $('accessCode').value.trim(); if (!access) return;
    $('loginButton').disabled = true; message('loginStatus', 'A verificar o acesso…');
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) }); showDashboard(); render(); }
    catch (error) { message('loginStatus', error.status === 401 ? 'Código de acesso inválido.' : error.message, 'error'); }
    finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (model.busy) return; model.busy = true; render();
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); showLogin('Sessão terminada.', '', { preserveRecovery: false }); }
    catch (error) { handleError(error); } finally { model.busy = false; render(); }
  });
  $('refreshButton').addEventListener('click', refreshStatus);
  $('verifyButton').addEventListener('click', verifyConnection);
  $('moreHistory').addEventListener('click', () => { fullHistory = true; render(); });
  $('resumeLegacyButton').addEventListener('click', () => {
    const active = preparingAttempt();
    if (!active || model.busy || $('resumeDialog').open) return;
    resumeTarget = active;
    $('legacyVideo').pause();
    $('resumeConfirmText').textContent = 'Confirmas que reveste o vídeo de ' + active.id + ' e queres continuar o envio já preparado para @autovalorpt?';
    $('resumeDialog').showModal();
  });
  $('cancelResume').addEventListener('click', () => $('resumeDialog').close());
  $('resumeDialog').addEventListener('close', () => { resumeTarget = null; });
  $('confirmResume').addEventListener('click', async () => {
    const target = resumeTarget, active = preparingAttempt();
    if (model.busy || !$('resumeDialog').open || !target || target.id !== active?.id || target.attemptId !== active.attemptId) return;
    resumeTarget = null; $('resumeDialog').close();
    const v = version; model.busy = true; render(); message('resumeStatus', 'A continuar o envio já preparado…');
    try {
      const result = await api(apiUrl('stories-resume'), { method: 'POST', body: JSON.stringify({ id: target.id, attemptId: target.attemptId, confirmed: true }) }, 285000);
      if (version !== v) return;
      message('resumeStatus', result.published === 1 ? 'O Instagram confirmou a publicação do Story.' :
        result.status === 'preparing' ? 'O Instagram continua a preparar o vídeo. Consulta o estado mais tarde.' :
        result.status === 'no_pending_story' ? 'Este envio já não está em processamento.' :
        'O resultado ficou por confirmar. Consulta o estado antes de continuar.');
    } catch (error) { if (v === version) handleError(error, 'resumeStatus'); }
    finally { if (v === version) { model.busy = false; await refreshStatus(); } }
  });
  $('technicalDetails').addEventListener('toggle', () => {
    if ($('technicalDetails').open && !model.status) void refreshStatus();
  });
  api('/api/admin-session').then(async (session) => {
    if (session.authenticated) { showDashboard(); render(); }
    else { showLogin(session.configured === false ? 'O acesso privado ainda está a ser configurado.' : ''); if (session.configured === false) $('loginButton').disabled = true; }
  }).catch((error) => showLogin(error.message, 'error'));
})();
