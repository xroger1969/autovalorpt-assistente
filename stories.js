(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ID = /^ID[A-Za-z0-9]{5,30}$/;
  const PROCESSED = new Set(['published', 'mapping_pending', 'retired', 'expired', 'unknown']);
  const LABELS = { baseline: 'Registo inicial', queued: 'Em fila', ready: 'Vídeo pronto', preview_ready: 'Pré-visualização pronta', preview_failed: 'Pré-visualização não concluída', published: 'Story publicado', mapping_pending: 'Publicado; confirmação em curso', mapped: 'Publicação confirmada', canceled: 'Cancelado', retired: 'Story retirado', expired: 'Story expirado', failed: 'Operação não concluída', unknown: 'Resultado por confirmar' };
  const REASONS = { facebook_authorization_required: 'Falta concluir a autorização Meta.', story_permissions_required: 'A autorização Meta precisa de permissões adicionais.', instagram_business_account_required: 'A conta tem de ser uma conta empresarial do Instagram.', story_publishing_limit_reached: 'O limite de publicações da conta foi atingido.', story_test_requires_latest_publication: 'A viatura já não é elegível. Verifique novamente a ligação e a disponibilidade.', story_already_processed: 'Esta viatura já foi processada. Atualize o estado.', video_signing_not_configured: 'A disponibilização do vídeo ainda não está configurada.', wrong_story_account: 'A conta ligada não corresponde a @autovalorpt.', story_provider_rejected: 'O Instagram ou a Meta recusou o pedido. Consulte o estado antes de repetir.', story_binding_changed: 'A configuração do registo mudou e precisa de verificação.' };
  let version = 0;
  const model = { status: null, verification: null, verifiedAt: 0, candidate: null, preview: null, busy: false, review: false, attemptedId: null, attemptedAt: 0, confirmationId: null };

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
      const url = new URL(value, location.origin);
      return url.origin === location.origin && url.pathname === '/api/stock' && url.searchParams.get('integration') === 'instagram-video' && url.searchParams.get('id') === id && !url.username && !url.password && !url.hash ? url.href : '';
    } catch { return ''; }
  }
  function storyUrl(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname) && /^\/stories\/autovalorpt\/\d+\/?$/.test(u.pathname) && !u.username && !u.password && !u.port && !u.search && !u.hash ? u.href : ''; } catch { return ''; }
  }
  function entries() { return Array.isArray(model.status?.items) ? model.status.items.filter((item) => ID.test(item.id)) : []; }
  function entryFor(id) { return entries().find((entry) => entry.id === id); }
  function candidateValid() {
    const at = Date.parse(model.candidate?.at || '');
    return ID.test(model.candidate?.id || '') && Number.isFinite(at) && at <= Date.now();
  }
  function canPreview() {
    const c = model.status?.configuration;
    return !model.busy && !model.review && !model.status?.active && candidateValid() && c?.production === true && c?.videoConfigured === true && !PROCESSED.has(entryFor(model.candidate.id)?.status);
  }
  function canPublish() {
    const otherCandidates = (model.verification?.candidates || []).some((id) => id !== model.candidate?.id);
    return canPreview() && model.status.configuration.enabled === true && model.verification?.ok !== false && model.verification?.authorization?.ready === true && Date.now() - model.verifiedAt < 10 * 60000 && model.preview?.id === model.candidate.id && model.preview?.ready === true && !otherCandidates && !entries().some((entry) => entry.status === 'mapping_pending');
  }
  function clearVideo() {
    $('videoPlayer').pause(); $('videoPlayer').removeAttribute('src'); $('videoPlayer').load(); $('downloadLink').removeAttribute('href');
    $('previewPanel').hidden = true; $('previewEmpty').hidden = false; model.preview = null;
  }
  function showVideo(id, value, ready) {
    const url = mediaUrl(value, id);
    if (!url) return false;
    model.preview = { id, ready, url };
    if ($('videoPlayer').src !== url) $('videoPlayer').src = url;
    $('downloadLink').href = url; $('downloadLink').download = `AutoValorPT_${id}.mp4`;
    $('previewPanel').hidden = false; $('previewEmpty').hidden = true;
    $('videoDetails').textContent = `${id} · 30 segundos · 1080 × 1920`;
    return true;
  }
  function render() {
    const c = model.status?.configuration;
    $('accountName').textContent = c?.username === 'autovalorpt' ? '@autovalorpt' : 'Por confirmar';
    $('enabledState').textContent = c ? (c.enabled ? 'Ativa' : 'Desativada') : 'Por confirmar';
    $('connectionState').textContent = model.verification ? (model.verification.authorization?.ready ? 'Verificada' : 'Por concluir') : 'Por verificar';
    $('refreshButton').disabled = model.busy; $('verifyButton').disabled = model.busy; $('logoutButton').disabled = model.busy;
    $('previewButton').disabled = !canPreview(); $('publishButton').disabled = !canPublish();
    const candidate = model.candidate;
    $('candidateName').textContent = candidate ? `Última viatura publicada em fotografia · ${candidate.id}` : 'Verifique a ligação para encontrar a viatura.';
    $('candidateDetails').textContent = candidate ? date(candidate.at) : '';
    const item = candidate && entryFor(candidate.id);
    $('candidateState').textContent = !candidate ? '' : PROCESSED.has(item?.status) ? (LABELS[item.status] || 'Já processada') : !candidateValid() ? 'A data da fotografia não ficou confirmada. Verifique novamente a ligação.' : model.preview?.id === candidate.id && model.preview.ready ? 'Disponibilidade confirmada ao criar esta pré-visualização. Será confirmada novamente antes de publicar.' : 'Disponibilidade a confirmar na criação da pré-visualização.';
    let help = 'Reveja a pré-visualização antes de publicar. A publicação exige ligação verificada e rotina ativa.';
    if (c && !c.enabled) help = 'A rotina de Stories está desativada. Pode rever um vídeo; a publicação permanece indisponível.';
    else if ((model.verification?.candidates || []).some((id) => id !== candidate?.id)) help = 'Existem outras viaturas na fila. O teste está bloqueado para preservar a ordem das publicações.';
    else if (model.review) help = 'Consulte o estado para confirmar o resultado anterior antes de continuar.';
    $('publishHelp').textContent = help;
    $('activeStatus').textContent = model.status?.active ? `Operação em curso: ${model.status.active.id} · iniciada em ${date(model.status.active.startedAt)}. Aguarde e atualize o estado.` : 'Nenhuma operação em curso no último estado consultado.';
    const list = $('historyList'); list.replaceChildren();
    const recent = entries().filter((entry) => entry.status !== 'baseline').sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 10);
    if (!recent.length) list.appendChild(node('li', 'Ainda não existem operações de vídeo registadas.'));
    for (const entry of recent) {
      const li = node('li', `${entry.id} · ${LABELS[entry.status] || 'Estado por confirmar'}`);
      li.appendChild(node('small', date(entry.at)));
      if (/^\d{5,30}$/.test(String(entry.instagramMediaId || ''))) li.appendChild(node('small', `Publicação Instagram: ${entry.instagramMediaId}`));
      const href = storyUrl(entry.permalink);
      if (href) { const a = node('a', 'Ver Story no Instagram'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.appendChild(a); }
      list.appendChild(li);
    }
  }
  function showLogin(text = '', kind = '') {
    version += 1;
    Object.assign(model, { status: null, verification: null, verifiedAt: 0, candidate: null, busy: false, review: false, confirmationId: null });
    if ($('publishDialog').open) $('publishDialog').close();
    clearVideo(); $('historyList').replaceChildren();
    $('dashboardView').hidden = true; $('privateNav').hidden = true; $('loginView').hidden = false; $('loginButton').disabled = false;
    message('loginStatus', text, kind);
  }
  function showDashboard() { $('accessCode').value = ''; $('loginView').hidden = true; $('dashboardView').hidden = false; $('privateNav').hidden = false; }
  function handleError(error, target = 'dashboardStatus') {
    if (error.status === 401) { showLogin(error.message); return; }
    message(target, error.message || 'Não foi possível concluir o pedido. Atualize o estado antes de repetir.', 'error');
  }
  function applyStatus(data) {
    model.status = data;
    const item = model.candidate && entryFor(model.candidate.id);
    if (model.review && !data.active) {
      const attempted = entryFor(model.attemptedId);
      if (attempted && Date.parse(attempted.at) >= model.attemptedAt - 1000 && attempted.status !== 'unknown') model.review = false;
    }
    if (item?.videoUrl && ['preview_ready', 'ready', 'published', 'mapping_pending'].includes(item.status)) showVideo(item.id, item.videoUrl, ['preview_ready', 'ready'].includes(item.status));
    else if (model.preview && item && !['preview_ready', 'ready'].includes(item.status)) clearVideo();
  }
  async function refreshStatus() {
    if (model.busy) return;
    model.busy = true; render(); message('dashboardStatus', 'A consultar o estado…'); const v = version;
    try {
      const data = await api(apiUrl('stories-status'));
      if (v !== version) return;
      if (data.ok === false) throw new Error('O estado não ficou confirmado. Não repita uma publicação sem confirmação.');
      applyStatus(data);
      message('dashboardStatus', model.review ? 'O resultado anterior ainda não ficou confirmado. A publicação permanece bloqueada.' : `Estado atualizado em ${date(new Date().toISOString())}.`, model.review ? 'error' : '');
    } catch (error) { if (v === version) handleError(error); }
    finally { if (v === version) { model.busy = false; render(); } }
  }
  async function verifyConnection() {
    if (model.busy) return;
    model.busy = true; model.verification = null; model.verifiedAt = 0; render(); message('verificationStatus', 'A verificar conta, autorização e viatura…'); const v = version;
    try {
      const data = await api(apiUrl('stories-dry-run'), {}, 90000);
      if (v !== version) return;
      applyStatus(data); model.verification = data; model.verifiedAt = Date.now();
      const candidate = data.latestPhotoPublication;
      if (model.candidate?.id !== candidate?.id) clearVideo();
      model.candidate = candidate && ID.test(candidate.id) ? { id: candidate.id, at: candidate.at } : null;
      const item = model.candidate && entryFor(model.candidate.id);
      if (item?.videoUrl && ['preview_ready', 'ready', 'published', 'mapping_pending'].includes(item.status)) showVideo(item.id, item.videoUrl, ['preview_ready', 'ready'].includes(item.status));
      const ready = data.ok !== false && data.authorization?.ready === true;
      message('verificationStatus', ready ? 'Conta @autovalorpt e ligação verificadas.' : REASONS[data.authorization?.reason] || 'A ligação ainda não está pronta para publicar.', ready ? 'success' : 'error');
    } catch (error) { if (v === version) handleError(error, 'verificationStatus'); }
    finally { if (v === version) { model.busy = false; render(); } }
  }
  async function runAction(kind, id) {
    const allowed = kind === 'preview' ? canPreview() : canPublish();
    if (!allowed || id !== model.candidate?.id) return;
    const v = version; model.busy = true; model.review = true; model.attemptedId = id; model.attemptedAt = Date.now(); render();
    const target = kind === 'preview' ? 'previewStatus' : 'publicationStatus';
    message(target, kind === 'preview' ? 'A criar a pré-visualização… Pode demorar alguns minutos.' : 'A enviar o vídeo para o Story… Aguarde a confirmação.');
    try {
      const result = await api(apiUrl(kind === 'preview' ? 'stories-preview' : 'stories-run', kind === 'preview' ? 'id' : 'sample_id', id), { method: 'POST' }, 285000);
      if (v !== version) return;
      if (result.status === 'preview_ready' && result.id === id && result.ok !== false) {
        model.review = false;
        if (!showVideo(id, result.videoUrl, true)) throw new Error('O vídeo ficou pronto, mas a ligação de reprodução não pertence a esta página. Abra a área privada de produção.');
        message(target, 'Pré-visualização pronta. Veja o vídeo completo e confirme os dados.', 'success');
      } else if (result.published === 1 && result.id === id) {
        model.review = false;
        message(target, result.status === 'mapping_pending' ? 'O Instagram confirmou a publicação. A confirmação cruzada ainda está em curso; não volte a publicar.' : 'O Instagram confirmou a publicação do Story.', 'success');
      } else {
        model.review = ['review_required', 'publish_unknown', 'delete_unknown'].includes(result.status) || result.inspectStatusBeforeRetry === true;
        const text = result.status === 'authorization_required' ? REASONS[result.authorization?.reason] || 'A autorização ainda não permite publicar.' : result.status === 'disabled' ? 'A rotina de Stories está desativada.' : result.status === 'busy' ? 'Já existe uma operação em curso. Aguarde e atualize o estado.' : result.status === 'preparing' ? 'O Instagram está a processar o vídeo. Atualize o estado antes de continuar.' : result.status === 'already_processed' ? 'Esta viatura já foi processada. A publicação não foi repetida.' : result.status === 'canceled' ? 'Operação cancelada: os dados ou a disponibilidade da viatura mudaram.' : 'A publicação não ficou confirmada. Atualize o estado antes de continuar.';
        message(target, text, result.ok === false ? 'error' : '');
      }
      const state = await api(apiUrl('stories-status'));
      if (v === version && state.ok !== false) applyStatus(state);
    } catch (error) {
      if (v === version) { model.review = true; handleError(error, target); }
    } finally { if (v === version) { model.busy = false; render(); } }
  }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const access = $('accessCode').value.trim(); if (!access) return;
    $('loginButton').disabled = true; message('loginStatus', 'A verificar o acesso…');
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) }); showDashboard(); await refreshStatus(); }
    catch (error) { message('loginStatus', error.status === 401 ? 'Código de acesso inválido.' : error.message, 'error'); }
    finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (model.busy) return; model.busy = true; render();
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); showLogin('Sessão terminada.'); }
    catch (error) { handleError(error); } finally { model.busy = false; render(); }
  });
  $('refreshButton').addEventListener('click', refreshStatus);
  $('verifyButton').addEventListener('click', verifyConnection);
  $('previewButton').addEventListener('click', () => runAction('preview', model.candidate?.id));
  $('publishButton').addEventListener('click', () => {
    if (!canPublish()) { message('publicationStatus', 'Verifique novamente a ligação e o estado antes de publicar.'); render(); return; }
    model.confirmationId = model.candidate.id;
    $('confirmText').textContent = `Confirma a publicação de um Story com o vídeo da viatura ${model.confirmationId}, cuja pré-visualização acabou de rever?`;
    $('publishDialog').showModal();
  });
  $('cancelPublishButton').addEventListener('click', () => $('publishDialog').close());
  $('publishDialog').addEventListener('close', () => { model.confirmationId = null; });
  $('confirmPublishButton').addEventListener('click', () => {
    const id = model.confirmationId; $('publishDialog').close();
    if (id === model.candidate?.id && canPublish()) runAction('publish', id);
    else { message('publicationStatus', 'A confirmação perdeu validade. Verifique novamente a ligação antes de publicar.'); render(); }
  });
  api('/api/admin-session').then(async (session) => {
    if (session.authenticated) { showDashboard(); await refreshStatus(); }
    else { showLogin(session.configured === false ? 'O acesso privado ainda está a ser configurado.' : ''); if (session.configured === false) $('loginButton').disabled = true; }
  }).catch((error) => showLogin(error.message, 'error'));
})();
