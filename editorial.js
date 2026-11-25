(() => {
  'use strict';
  const { imageUrl, videoUrl, renderPreviewLinks } = globalThis.AutoValorEditorialPreview;
  const $ = id => document.getElementById(id);
  const API = '/api/stock?integration=editorial&action=';
  const LABELS = {
    published: 'Publicação confirmada', already_published: 'Publicação já confirmada',
    disabled: 'Rotina pausada', not_due: 'A aguardar o horário', before_start: 'A aguardar o início',
    busy: 'Operação em curso', preparing: 'A preparar', publishing: 'A confirmar publicação',
    publish_unknown: 'Publicação por confirmar', unknown: 'Resultado por confirmar',
    review_required: 'Precisa de atenção', failed: 'Publicação não concluída',
    authorization_required: 'Ligação por verificar', production_only: 'Publicação indisponível aqui',
    skipped: 'Sem publicação', paused: 'Rotina pausada', wrong_season: 'Fora deste horário'
  };
  const EXPLANATIONS = {
    published: 'O Instagram confirmou a publicação deste conteúdo.',
    already_published: 'Este conteúdo já tinha sido publicado. Não foi repetido.',
    disabled: 'A rotina está pausada. Podes voltar a ativá-la neste painel.',
    not_due: 'A próxima publicação aguarda a janela diária prevista.',
    before_start: 'A rotina ainda não chegou à data de início.',
    publish_unknown: 'A confirmação ainda não chegou. A rotina evita repetir esta tentativa enquanto o resultado estiver por confirmar.',
    unknown: 'O resultado precisa de confirmação antes de se repetir qualquer tentativa.',
    failed: 'Não foi possível concluir esta publicação. Consulta o estado da ligação.',
    authorization_required: 'É necessário verificar a ligação ao Instagram.',
    review_required: 'Esta tentativa precisa de verificação antes de continuar.',
    production_only: 'A publicação automática está disponível no site principal.'
  };
  let authenticated = false;
  let busy = false;
  let generation = 0;
  let current = null;
  let slide = 0;

  function text(id, value = '') { $(id).textContent = value; }
  function badge(id, value, state = 'light') { text(id, value); $(id).className = `badge ${state}`; }
  function element(tag, value, className) {
    const node = document.createElement(tag); node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function date(value, withTime = true) {
    const parsed = new Date(value || '');
    if (!Number.isFinite(parsed.getTime())) return 'Data por confirmar';
    return new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) }).format(parsed);
  }
  function validDay(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  }
  function postLink(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
      if (!/^\/(?:autovalorpt\/)?(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
      url.search = ''; url.hash = ''; return url.href;
    } catch { return null; }
  }

  function clearVideo() {
    const video = $('previewVideo');
    if (typeof video.pause === 'function') video.pause();
    video.removeAttribute('src'); video.removeAttribute('poster');
    if (typeof video.load === 'function') video.load();
    $('videoFrame').hidden = true;
  }
  function resultLabel(result) { return LABELS[result?.status] || 'Resultado por confirmar'; }
  function resultKind(result) {
    if (['published', 'already_published'].includes(result?.status)) return 'good';
    if (['publish_unknown', 'unknown', 'review_required', 'failed', 'authorization_required'].includes(result?.status)) return 'error';
    return 'pending';
  }
  async function api(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.ok === false) throw Object.assign(new Error('Pedido indisponível'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); }
  }
  function clearPrivateView() {
    renderPreviewLinks();
    current = null; slide = 0;
    for (const id of ['dashboardStatus', 'readAt', 'resultDescription', 'resultTime', 'previewDate', 'captionText', 'copyStatus', 'imageStatus']) text(id);
    badge('routineBadge', 'Por consultar'); badge('resultBadge', 'Por consultar');
    text('nextRun', 'Por confirmar'); text('connectionStatus', 'Ligação ao Instagram por consultar.');
    text('routineDescription', 'A consultar a configuração da rotina…');
    text('previewTitle', 'Próximo conteúdo'); text('previewEmpty', 'A pré-visualização aparece depois de consultarmos a rotina.');
    text('historyEmpty', 'Ainda sem resultados consultados.'); text('toggleButton', 'Por consultar');
    $('toggleButton').disabled = true; $('historyList').replaceChildren();
    for (const id of ['previewContent', 'formatBadge', 'slideControls', 'lastPostLink', 'historyCount']) $(id).hidden = true;
    $('previewEmpty').hidden = false; $('historyEmpty').hidden = false;
    $('previewImage').removeAttribute('src'); $('previewImage').alt = ''; $('lastPostLink').removeAttribute('href');
    clearVideo();
  }
  function sessionView(value, message = '') {
    authenticated = value; generation++;
    $('dashboardView').hidden = !value; $('privateNav').hidden = !value; $('loginView').hidden = value;
    $('accessCode').value = ''; $('loginButton').disabled = false; text('loginStatus', message);
    if (!value) clearPrivateView();
  }
  function setBusy(value) {
    busy = value;
    for (const id of ['refreshButton', 'logoutButton']) $(id).disabled = value;
    $('toggleButton').disabled = value || !current || typeof current.enabled !== 'boolean';
  }
  function renderSlide() {
    const post = current?.nextPost;
    if (post?.format === 'REELS') return;
    const count = Number.isSafeInteger(post?.slideCount) && post.slideCount > 0 && post.slideCount <= 10 ? post.slideCount : 0;
    const src = count ? imageUrl(post, slide) : null;
    if (!src) return;
    text('imageStatus');
    $('previewImage').alt = `${post.title || 'Conteúdo AutoValorPT'} — imagem ${slide + 1} de ${count}`;
    $('previewImage').src = src;
    text('slidePosition', `${slide + 1} / ${count}`);
    $('slideControls').hidden = count <= 1;
    $('previousSlide').disabled = slide === 0; $('nextSlide').disabled = slide >= count - 1;
  }
  function renderPreview(post) {
    slide = 0; text('copyStatus'); text('imageStatus');
    const reel = post?.format === 'REELS';
    const valid = validDay(post?.date) && (reel || Number.isSafeInteger(post?.slideCount) && post.slideCount >= 1 && post.slideCount <= 10);
    renderPreviewLinks(valid ? post : null);
    $('previewContent').hidden = !valid; $('previewEmpty').hidden = valid; $('formatBadge').hidden = !valid;
    if (!valid) {
      text('previewTitle', 'Próximo conteúdo'); text('previewDate');
      text('previewEmpty', 'O próximo conteúdo ainda não está disponível para consulta.');
      text('captionText'); $('previewImage').removeAttribute('src'); clearVideo(); return;
    }
    text('previewTitle', typeof post.title === 'string' ? post.title : 'Conteúdo AutoValorPT');
    text('formatBadge', reel ? 'Reel' : post.format === 'CAROUSEL' ? 'Carrossel' : 'Imagem');
    const previewDay = date(post.date + 'T12:00:00Z', false);
    text('previewDate', post.provisional === true ? 'Previsto para ' + previewDay +
      '. As fontes e a legenda serão preparadas mais perto da publicação.' : 'Preparado para ' + previewDay + '.');
    text('captionText', typeof post.caption === 'string' ? post.caption : 'Legenda por consultar.');
    $('copyCaption').disabled = typeof post.caption !== 'string' || !post.caption;
    $('imageFrame').hidden = reel;
    if (reel) {
      $('slideControls').hidden = true; $('previewImage').removeAttribute('src');
      const src = videoUrl(post.videoUrl);
      if (src) {
        const video = $('previewVideo');
        if (video.getAttribute('src') !== src) {
          clearVideo(); video.src = src;
          const covers = post.imageUrls || post.images;
          const poster = Array.isArray(covers) && covers.length ? imageUrl(post, 0) : null;
          if (poster) video.poster = poster;
        }
        $('videoFrame').hidden = false;
      } else {
        clearVideo(); text('imageStatus', 'O vídeo ainda não está disponível para pré-visualização. A legenda continua disponível.');
      }
    } else { clearVideo(); renderSlide(); }
  }
  function renderResult(data) {
    const result = data.lastResult;
    const active = data.active;
    const link = !active && ['published', 'already_published'].includes(result?.status) ? postLink(result.permalink) : null;
    $('lastPostLink').hidden = !link;
    if (link) $('lastPostLink').href = link; else $('lastPostLink').removeAttribute('href');
    if (active) {
      const uncertain = /unknown|uncertain/.test(active.phase || '');
      badge('resultBadge', uncertain ? 'Publicação por confirmar' : 'Operação em curso', uncertain ? 'error' : 'pending');
      text('resultDescription', uncertain ? EXPLANATIONS.publish_unknown : 'Existe uma tentativa em curso. A confirmação aparecerá neste painel quando estiver concluída.');
      text('resultTime', active.startedAt ? `Início: ${date(active.startedAt)}.` : '');
    } else if (result) {
      badge('resultBadge', resultLabel(result), resultKind(result));
      const explanation = EXPLANATIONS[result.status] || 'Consulta o próximo resultado para confirmar se houve publicação.';
      text('resultDescription', `${explanation}${result.reason === 'ai_label_unconfirmed' ? ' A indicação de conteúdo criado com IA ainda precisa de confirmação no Instagram.' : ''}`);
      text('resultTime', result.at ? `Registo: ${date(result.at)}.` : '');
    } else {
      badge('resultBadge', 'Ainda sem execução', 'light');
      text('resultDescription', 'Ainda não há uma publicação criativa confirmada por esta rotina.'); text('resultTime');
    }
  }
  function renderHistory(history) {
    const rows = Array.isArray(history) ? history.slice(0, 14) : [];
    $('historyList').replaceChildren(); $('historyEmpty').hidden = rows.length > 0; $('historyCount').hidden = rows.length === 0;
    text('historyEmpty', 'O histórico começa com a primeira tentativa da rotina.'); text('historyCount', String(rows.length));
    for (const row of rows) {
      const item = element('li', '');
      item.appendChild(element('span', validDay(row.date) ? date(`${row.date}T12:00:00Z`, false) : date(row.at, false), 'history-date'));
      item.appendChild(element('strong', typeof row.title === 'string' ? row.title : 'Conteúdo AutoValorPT'));
      const bottom = element('div', '', 'history-bottom');
      bottom.appendChild(element('span', resultLabel(row), `badge ${resultKind(row)}`));
      const href = ['published', 'already_published'].includes(row.status) ? postLink(row.permalink) : null;
      if (href) {
        const link = element('a', 'Ver publicação ↗'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; bottom.appendChild(link);
      }
      item.appendChild(bottom); $('historyList').appendChild(item);
      if (row.reason === 'ai_label_unconfirmed') item.appendChild(element('p', 'Indicação de IA por confirmar no Instagram.', 'small muted'));
    }
  }
  function render(data) {
    current = data;
    const config = data.configuration || {};
    const auth = data.authorization || {};
    badge('routineBadge', data.enabled === true ? 'Rotina ativa' : data.enabled === false ? 'Rotina pausada' : 'Por confirmar', data.enabled === true ? 'active' : 'paused');
    text('toggleButton', data.enabled === true ? 'Pausar publicações' : data.enabled === false ? 'Ativar publicações' : 'Por consultar');
    text('routineDescription', data.enabled === true ? 'Uma publicação criativa por dia, com temas diferentes. O horário pode variar dentro da janela prevista.' : data.enabled === false ? 'As próximas publicações criativas ficam suspensas até voltares a ativar a rotina.' : 'O estado atual da rotina precisa de confirmação.');
    text('nextRun', data.enabled === false ? 'Rotina pausada' : data.schedule?.nextRunAt ? date(data.schedule.nextRunAt) : 'Horário por confirmar');
    const configured = config.tokenConfigured === true && config.accountConfigured === true && config.validApi === true && config.imagesConfigured === true;
    text('connectionStatus', config.production === false ? 'A publicação automática está disponível no site principal.' : auth.expired === true ? 'O acesso ao Instagram expirou e precisa de renovação.' : auth.lastError ? 'A renovação do acesso ao Instagram precisa de verificação.' : configured ? 'Ligação ao Instagram configurada. Cada publicação será confirmada no histórico.' : 'A configuração da ligação ao Instagram precisa de verificação.');
    renderPreview(data.nextPost); renderResult(data); renderHistory(data.history);
    text('readAt', `Última consulta: ${date(new Date().toISOString())}.`);
  }
  function unavailable(message) {
    clearPrivateView(); badge('routineBadge', 'Estado por confirmar', 'warning');
    badge('resultBadge', 'Leitura indisponível', 'error');
    text('routineDescription', 'Não foi possível obter o estado atual. Atualiza este painel para tentar novamente.');
    text('dashboardStatus', message);
  }
  async function refresh() {
    if (!authenticated || busy) return;
    setBusy(true); const version = generation; text('dashboardStatus', 'A consultar a rotina…');
    try {
      const data = await api(`${API}status`);
      if (version !== generation) return;
      render(data); text('dashboardStatus');
    } catch (error) {
      if (version !== generation) return;
      if (error.status === 401) sessionView(false, 'A sessão terminou. Volta a entrar para consultar a rotina.');
      else unavailable('Não foi possível consultar a rotina. O estado e a próxima publicação ficam por confirmar.');
    } finally { if (version === generation || !authenticated) setBusy(false); }
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const access = $('accessCode').value.trim(); if (!access) return;
    $('loginButton').disabled = true; text('loginStatus', 'A verificar o acesso…');
    try {
      await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) });
      sessionView(true); await refresh();
    } catch (error) {
      $('accessCode').value = '';
      text('loginStatus', error.status === 401 ? 'Código de acesso inválido.' : error.status === 429 ? 'Demasiadas tentativas. Aguarda antes de voltar a tentar.' : 'Não foi possível entrar. Tenta novamente.');
    } finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (busy) return; setBusy(true);
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); sessionView(false, 'Sessão terminada.'); }
    catch { text('dashboardStatus', 'Não foi possível terminar a sessão. Tenta novamente.'); }
    finally { setBusy(false); }
  });
  $('toggleButton').addEventListener('click', async () => {
    if (!authenticated || busy || typeof current?.enabled !== 'boolean') return;
    const enabled = !current.enabled; const version = generation;
    setBusy(true); text('dashboardStatus', enabled ? 'A ativar a rotina…' : 'A pausar a rotina…');
    try {
      const data = await api(`${API}settings`, { method: 'POST', body: JSON.stringify({ enabled }) });
      if (version !== generation) return;
      render(data);
      text('dashboardStatus', data.enabled === enabled ? enabled ? 'Rotina ativa. A próxima publicação seguirá o horário previsto.' : 'Rotina pausada. As próximas publicações criativas ficam suspensas.' : 'Não foi possível confirmar a alteração. Consulta novamente o estado.');
    } catch (error) {
      if (version !== generation) return;
      if (error.status === 401) sessionView(false, 'A sessão terminou. Volta a entrar.');
      else unavailable('Não foi possível confirmar a alteração. Atualiza o estado antes de voltar a tentar.');
    } finally { if (version === generation || !authenticated) setBusy(false); }
  });
  $('refreshButton').addEventListener('click', refresh);
  $('previousSlide').addEventListener('click', () => { if (slide > 0) { slide--; renderSlide(); } });
  $('nextSlide').addEventListener('click', () => { if (slide + 1 < (current?.nextPost?.slideCount || 0)) { slide++; renderSlide(); } });
  $('previewImage').addEventListener('error', () => text('imageStatus', 'Não foi possível carregar esta imagem. A legenda continua disponível.'));
  $('previewImage').addEventListener('load', () => text('imageStatus'));
  $('previewVideo').addEventListener('error', () => text('imageStatus', 'Não foi possível carregar este vídeo. A legenda continua disponível.'));
  $('previewVideo').addEventListener('loadedmetadata', () => text('imageStatus'));
  $('copyCaption').addEventListener('click', async () => {
    const caption = current?.nextPost?.caption; if (typeof caption !== 'string' || !caption) return;
    try { await navigator.clipboard.writeText(caption); text('copyStatus', 'Legenda copiada.'); }
    catch { text('copyStatus', 'Mantém o dedo sobre a legenda para a selecionar e copiar.'); }
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  api('/api/admin-session').then(async session => {
    sessionView(session.authenticated === true, session.configured === false ? 'O acesso privado ainda está a ser configurado.' : '');
    if (session.configured === false) $('loginButton').disabled = true;
    if (authenticated) await refresh();
  }).catch(() => sessionView(false, 'Não foi possível verificar a sessão. Tenta entrar novamente.'));
})();
