(() => {
  'use strict';
  const panel = document.getElementById('routineCalendar');
  if (!panel) return;
  const list = document.getElementById('calendarItems');
  const status = document.getElementById('calendarStatus');
  const refresh = document.getElementById('calendarRefresh');
  const { validDay, imageUrl, videoUrl, renderSources, renderCopyCredit } = globalThis.AutoValorEditorialPreview;
  const locale = { timeZone: 'Europe/Lisbon' };
  const dayLabel = new Intl.DateTimeFormat('pt-PT', { ...locale, weekday: 'short', day: 'numeric', month: 'long' });
  const clock = new Intl.DateTimeFormat('pt-PT', { ...locale, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const cacheDay = new Intl.DateTimeFormat('en-CA', { ...locale, year: 'numeric', month: '2-digit', day: '2-digit' });
  const statuses = { paused: 'Rotina pausada', review_required: 'Publicação por confirmar', preparing: 'Em preparação',
    publishing: 'A publicar', creating: 'Em preparação', published: 'Publicada', failed: 'Publicação falhada',
    skipped: 'Sem publicação', unavailable: 'Conteúdo por confirmar' };
  const formats = { IMAGE: 'Imagem', CAROUSEL: 'Carrossel', REELS: 'Reel' };
  let authenticated = false, onExpiry, request = null, cache = null, nextPost = null;
  const updateRows = new Set();

  function element(tag, text = '', className) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function pauseMedia() {
    list.querySelectorAll('video').forEach(video => video.pause());
  }
  function clearResults() {
    pauseMedia(); updateRows.clear(); list.replaceChildren(); status.textContent = '';
  }
  function cancel() {
    if (request) { request.abort(); request = null; }
    refresh.disabled = false;
  }
  function fresh() {
    return cache && Date.now() - cache.at < 5 * 60000 && cache.day === cacheDay.format(Date.now());
  }
  function valid(data) {
    return data?.ok === true && data.timezone === 'Europe/Lisbon' && Array.isArray(data.items) && data.items.length === 7 &&
      data.items.every((post, i) => validDay(post?.date) && (!i || post.date > data.items[i - 1].date));
  }
  function media(post, area) {
    const count = post.slideCount;
    const hasImages = Number.isInteger(count) && count > 0 && count <= 10 && Array.isArray(post.images) && post.images.length >= count;
    const note = element('p', '', 'hint');
    if (post.format === 'REELS' && videoUrl(post.videoUrl)) {
      const player = element('video');
      player.controls = true; player.playsInline = true; player.preload = 'metadata';
      player.setAttribute('aria-label', 'Pré-visualização do Reel · ' + post.title);
      if (hasImages) player.poster = imageUrl(post, 0);
      player.addEventListener('error', () => { note.textContent = 'Não foi possível abrir este vídeo.'; });
      player.src = videoUrl(post.videoUrl);
      area.append(player, note);
    } else if (['IMAGE', 'CAROUSEL'].includes(post.format) && hasImages) {
      const photo = element('img');
      photo.width = 1080; photo.height = 1350; photo.decoding = 'async';
      const position = element('span'), previous = element('button', 'Anterior', 'secondary'), next = element('button', 'Seguinte', 'secondary');
      previous.type = 'button'; next.type = 'button'; position.setAttribute('aria-live', 'polite');
      let current = 0;
      function slide(index) {
        if (index < 0 || index >= count) return;
        current = index; previous.disabled = index === 0; next.disabled = index === count - 1;
        note.textContent = ''; position.textContent = (index + 1) + ' / ' + count;
        photo.alt = post.altTexts?.[index] || post.title + ' · imagem ' + (index + 1);
        photo.src = imageUrl(post, index);
      }
      photo.addEventListener('error', () => { note.textContent = 'Não foi possível abrir esta imagem.'; });
      area.append(photo, note);
      if (count > 1) {
        const controls = element('div', '', 'toolbar');
        previous.addEventListener('click', () => slide(current - 1)); next.addEventListener('click', () => slide(current + 1));
        controls.append(previous, position, next); area.appendChild(controls);
      }
      slide(0);
    } else area.appendChild(element('p', 'Pré-visualização indisponível.', 'hint'));
  }
  function row(post) {
    const detail = element('details', '', 'calendar-entry'), summary = element('summary');
    const date = dayLabel.format(new Date(post.date + 'T12:00:00Z'));
    const at = Date.parse(post.scheduledAt);
    summary.appendChild(element('span', Number.isFinite(at) ? date + ' · ' + clock.format(at) : date, 'time'));
    summary.appendChild(element('strong', post.title || 'Conteúdo por confirmar'));
    const info = element('span', '', 'hint'), area = element('div', '', 'calendar-preview');
    const caption = element('p', '', 'calendar-caption'), sources = element('details');
    const links = element('ul'), credit = element('p', '', 'hint');
    sources.append(element('summary', 'Fontes do conteúdo'), links);
    summary.appendChild(info); detail.append(summary, area);
    let previousSources;
    function update() {
      const prepared = post.provisional === true && nextPost && nextPost.id === post.id && nextPost.date === post.date ? nextPost : null;
      const tags = [post.topic && post.topic !== post.title ? post.topic : '', formats[post.format], statuses[post.status],
        !prepared && post.provisional === true ? 'Provisório' : ''].filter(Boolean).join(' · ');
      info.hidden = !tags;
      if (info.textContent !== tags) info.textContent = tags;
      const copy = prepared || post;
      renderCopyCredit(credit, copy);
      const content = typeof copy.caption === 'string' ? copy.caption : '';
      caption.hidden = !content;
      if (caption.textContent !== content) caption.textContent = content;
      if (copy.sources !== previousSources) {
        renderSources(copy.sources, sources, links); previousSources = copy.sources;
      }
    }
    sources.hidden = true;
    updateRows.add(update); update();
    detail.addEventListener('toggle', () => {
      if (!detail.open) { area.querySelector('video')?.pause(); return; }
      if (authenticated && panel.open && !area.firstChild) {
        media(post, area); area.append(caption, credit, sources);
      }
    });
    return detail;
  }
  function render(data) {
    clearResults();
    status.textContent = [data.enabled === false ? 'A rotina está pausada.' : '',
      data.blocked === true ? 'Há uma publicação por confirmar. As datas seguintes podem mudar.' : ''].filter(Boolean).join(' ');
    for (const post of data.items) list.appendChild(row(post));
  }
  async function load() {
    if (!authenticated || !panel.open || request) return;
    if (fresh()) { if (!list.firstChild) render(cache.data); return; }
    const controller = new AbortController();
    request = controller; refresh.disabled = true;
    clearResults(); status.textContent = 'A consultar as próximas publicações…';
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('/api/stock?integration=editorial&action=calendar', {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' }, signal: controller.signal
      });
      if (controller !== request) return;
      if (response.status === 401) { const expire = onExpiry; setSession(false); expire?.(); return; }
      if (!response.ok) throw new Error('calendar_unavailable');
      const data = await response.json();
      if (controller !== request || !authenticated || !panel.open) return;
      if (!valid(data)) throw new Error('calendar_invalid');
      cache = { at: Date.now(), day: cacheDay.format(Date.now()), data }; render(data);
    } catch {
      if (controller === request && authenticated && panel.open) {
        cache = null; clearResults(); status.textContent = 'Não foi possível consultar o calendário. Tenta atualizar.';
      }
    } finally {
      clearTimeout(timeout);
      if (controller === request) { request = null; refresh.disabled = false; }
    }
  }
  function invalidate() {
    cancel(); cache = null; clearResults();
    if (authenticated && panel.open) void load();
  }
  function setNextPost(post) {
    nextPost = authenticated && post?.provisional !== true && typeof post?.id === 'string' && post.id &&
      validDay(post.date) && typeof post.caption === 'string' && post.caption.trim()
      ? { id: post.id, date: post.date, caption: post.caption, copyOrigin: post.copyOrigin, copyModel: post.copyModel, sources: Array.isArray(post.sources) ? post.sources : undefined } : null;
    for (const update of updateRows) update();
  }
  function setSession(value, expire) {
    cancel(); cache = null; nextPost = null; authenticated = value; onExpiry = expire;
    panel.open = false; clearResults();
  }
  panel.addEventListener('toggle', () => { if (panel.open) void load(); else { cancel(); pauseMedia(); } });
  refresh.addEventListener('click', invalidate);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && panel.open && !fresh()) void load(); });
  globalThis.AutoValorRoutineCalendar = { setSession, setNextPost, invalidate };
})();
