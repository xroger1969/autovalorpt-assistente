(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('estado-whatsapp'), select = $('waTipSelect');
  const stateLabels = { ready: 'Por partilhar', unconfirmed: 'Por confirmar', confirmed: 'Observada no Estado' };
  const toolUrls = new Set(['https://carregador.vercel.app/', 'https://credicarros.vercel.app/simulador-ano.html']);
  const manualGuide = 'Descarrega os ficheiros. Se estiveres no computador, transfere-os e leva a legenda para o telemóvel da conta AutoValorPT. No WhatsApp Business do telemóvel, abre Atualizações → Adicionar estado, escolhe os ficheiros, cola a legenda e toca na seta de envio.';
  const { imageUrl, videoUrl, validDay } = globalThis.AutoValorEditorialPreview;
  let authenticated = false, expire, revision = 0, lastListedAt = 0, busy = false, items = [], selected, prepared;
  function note(text) { $('waTipMessage').textContent = text; }
  function revokeDownloads(downloads) {
    for (const url of downloads) URL.revokeObjectURL(url);
  }
  function clearFiles() {
    if (prepared) revokeDownloads(prepared.downloads);
    prepared = null;
    $('waTipDownloads').replaceChildren(); $('waTipHandoff').hidden = true; $('waTipShare').hidden = true;
  }
  function available(row) {
    if (!row || !Object.hasOwn(stateLabels, row.status) || typeof row.id !== 'string' || !validDay(row.date) ||
        typeof row.title !== 'string' || !Array.isArray(row.media) || row.media.length < 1 || row.media.length > 10) return false;
    return row.media.every((file, index) => {
      if (!file || typeof file.url !== 'string' || !file.url.startsWith('/')) return false;
      if (file.mime === 'video/mp4') return row.media.length === 1 && videoUrl(file.url) === file.url;
      if (file.mime !== 'image/jpeg') return false;
      const source = new URL(file.url, location.origin);
      if (source.origin !== location.origin || source.pathname !== '/api/stock' || source.hash ||
          source.searchParams.get('date') !== row.date || source.searchParams.get('slide') !== String(index + 1) ||
          source.searchParams.get('integration') !== 'editorial-image' ||
          (source.searchParams.get('extra') === '1') !== (row.extra === true) ||
          !['v1','v2','v3','v4'].includes(source.searchParams.get('v'))) return false;
      const expected = new URL(imageUrl({ date: row.date, extra: row.extra, version: source.searchParams.get('v') }, index), location.origin);
      if (!source.searchParams.has('theme')) expected.searchParams.delete('theme');
      if (source.searchParams.get('variant') === 'wa1') expected.searchParams.set('variant', 'wa1');
      source.searchParams.sort(); expected.searchParams.sort();
      return source.href === expected.href;
    });
  }
  function canReview() {
    // Old reservations may already have reached WhatsApp on another device.
    return selected?.status === 'unconfirmed' && (!prepared || prepared.review);
  }
  function canCancel() {
    return selected?.status === 'unconfirmed' && prepared?.canceled && !prepared.review;
  }
  function controls() {
    const item = selected;
    select.disabled = busy; $('waTipRefresh').disabled = busy || !authenticated;
    $('waTipPicker').hidden = !item;
    $('waTipPrepare').hidden = item?.status !== 'ready'; $('waTipPrepare').disabled = busy;
    $('waTipReview').hidden = !canReview() && !canCancel();
    $('waTipConfirm').hidden = !canReview();
    $('waTipRelease').textContent = canCancel() ? 'Cancelar tentativa de partilha' : 'Não enviei · retomar partilha';
    $('waTipReviewHint').textContent = canCancel()
      ? 'Podes tentar novamente com os mesmos ficheiros ou cancelar a tentativa se a dica não foi enviada.'
      : prepared
      ? 'Depois de enviares, verifica se a dica ficou visível em «O meu estado» no WhatsApp Business da AutoValorPT.'
      : 'Ficou uma tentativa anterior por confirmar. Verifica «O meu estado» da AutoValorPT. Se a dica não está lá e não há outro envio em curso, toca em «Não enviei · retomar partilha».';
    $('waTipHandoff').hidden = !prepared || prepared.shared;
    $('waTipShare').hidden = !prepared?.payload;
    $('waTipConfirm').disabled = $('waTipRelease').disabled = busy;
    $('waTipShare').disabled = busy;
  }
  function show(item) {
    clearFiles(); selected = item; $('waTipMedia').replaceChildren();
    $('waTipText').open = Boolean(item); $('waTipCopyStatus').textContent = '';
    $('waTipCaption').textContent = item?.shareCaption || item?.caption || '';
    $('waTipCopy').disabled = !$('waTipCaption').textContent;
    $('waTipCopyLink').hidden = !toolUrls.has(item?.simulatorUrl);
    controls();
    if (!item) return;
    select.value = item.id;
    const first = item.media[0];
    const media = document.createElement(first.mime === 'video/mp4' ? 'video' : 'img');
    if (first.mime === 'video/mp4') {
      media.controls = true; media.playsInline = true; media.preload = 'none';
      media.setAttribute('aria-label', 'Pré-visualização do vídeo · ' + item.title);
    } else media.alt = typeof item.altTexts?.[0] === 'string' && item.altTexts[0].trim() ? item.altTexts[0] : item.title;
    media.src = first.url; $('waTipMedia').appendChild(media);
    const mediaNote = [];
    if (item.media.length > 1) mediaNote.push('Primeira de ' + item.media.length + ' imagens.');
    if (first.mime === 'image/jpeg' && new URL(first.url, location.origin).searchParams.get('variant') === 'wa1') {
      mediaNote.push('A imagem já inclui um resumo da dica.');
    }
    if (mediaNote.length) {
      const hint = document.createElement('small'); hint.textContent = mediaNote.join(' ');
      $('waTipMedia').appendChild(hint);
    }
    note(item.status === 'confirmed' ? 'Já registaste esta dica como visível no Estado.' :
      item.status === 'unconfirmed' ? 'Há uma partilha por confirmar. Verifica o Estado antes de repetir.' : '');
  }
  async function api(action, payload) {
    const response = await fetch('/api/stock?integration=whatsapp-status&action=tip-' + action, {
      method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(30000), headers: payload ? { 'Content-Type': 'application/json' } : {},
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Object.assign(new Error('tip_request_failed'), { status: response.status });
    return data;
  }
  async function work(task, failure) {
    if (!authenticated || busy) return;
    const seen = revision; busy = true; controls();
    const current = () => authenticated && seen === revision;
    try { await task(current); }
    catch (error) {
      if (!current()) return;
      if (error.status === 401) { expire?.(); return; }
      clearFiles();
      show(null); items = []; lastListedAt = 0; select.replaceChildren();
      note(error.status === 409 ? 'O registo mudou. Atualiza a lista antes de continuar.' : failure);
    } finally { if (current()) { busy = false; controls(); } }
  }
  function options() {
    select.replaceChildren();
    for (const item of items) {
      const opt = document.createElement('option'); opt.value = item.id;
      const day = item.date.split('-').reverse().join('/');
      opt.textContent = day + (item.extra ? ' · Extra · ' : ' · Diária · ') + item.title + ' · ' + (prepared?.item === item && !prepared.review ? 'Pronta a partilhar' : stateLabels[item.status]);
      select.appendChild(opt);
    }
    if (selected) select.value = selected.id;
  }
  function load() {
    return work(async current => {
      const id = selected?.id;
      const previousMessage = $('waTipMessage').textContent;
      note('A consultar as dicas publicadas…');
      const data = await api('list');
      if (!current()) return;
      if (!Array.isArray(data.items)) throw new Error('invalid_list');
      items = data.items.filter(available); lastListedAt = Date.now();
      const item = items.find(item => item.id === id);
      if (prepared && item?.status === 'unconfirmed' && item.attemptId === prepared.item.attemptId) {
        selected = prepared.item = item;
        options(); note(previousMessage);
        return;
      }
      show(item || items[0]); options();
      if (!selected) note('Ainda não há dicas publicadas disponíveis para o Estado.');
    }, 'Não foi possível consultar as dicas. Toca em «Atualizar lista de dicas».');
  }
  function nameFor(item, index) {
    return 'AutoValorPT-' + item.date + (item.extra ? '-extra-' : '-dica-') + (index + 1) +
      (item.media[index].mime === 'video/mp4' ? '.mp4' : '.jpg');
  }
  function supportedPayload(files, text) {
    for (const payload of [{ files, text }, { files }]) {
      try { if (navigator.canShare(payload)) return payload; } catch { /* Try the next format. */ }
    }
    return null;
  }
  async function loadFiles(item, current) {
    const files = [];
    for (const [index, media] of item.media.entries()) {
      const response = await fetch(media.url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(45000) });
      if (!current()) return files;
      if (response.status === 401) throw Object.assign(new Error('media_access_expired'), { status: 401 });
      if (!response.ok || (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase() !== media.mime) throw new Error('media_unavailable');
      const blob = await response.blob();
      if (!blob.size) throw new Error('media_empty');
      files.push(typeof File === 'function' ? new File([blob], nameFor(item, index), { type: media.mime }) : blob);
      if (!current()) return files;
    }
    return files;
  }
  async function prepareItem(item, current) {
    note('A preparar os ficheiros para o Estado…');
    let files;
    try { files = await loadFiles(item, current); }
    catch (error) {
      if (error.status === 401) throw error;
      if (current()) note('Não foi possível carregar o ficheiro. Volta a escolher «Preparar dica e copiar legenda» para tentar novamente.');
      return;
    }
    if (!current()) return;
    const payload = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && typeof File === 'function'
      ? supportedPayload(files, item.shareCaption || item.caption) : null;
    const requestId = crypto.randomUUID();
    const handoff = { item, payload, downloads: [], review: false, shared: false, canceled: false };
    try {
      for (const file of files) handoff.downloads.push(URL.createObjectURL(file));
      const result = await api('claim', { id: item.id, requestId });
      if (!current()) return;
      if (result.status !== 'unconfirmed' || result.attemptId !== requestId) throw new Error('claim_unconfirmed');
      item.status = result.status; item.attemptId = requestId;
      prepared = handoff;
    } finally {
      if (prepared !== handoff) revokeDownloads(handoff.downloads);
    }
    options();
    for (const [index, media] of item.media.entries()) {
      const a = document.createElement('a'); a.className = 'link'; a.href = handoff.downloads[index]; a.download = nameFor(item, index);
      a.textContent = media.mime === 'video/mp4' ? 'Descarregar vídeo' : 'Descarregar imagem' + (item.media.length > 1 ? ' ' + (index + 1) : '');
      a.addEventListener('click', event => {
        if (busy || prepared !== handoff || !authenticated) { event.preventDefault(); return; }
        handoff.review = true;
        options(); controls();
        note(manualGuide);
      });
      $('waTipDownloads').appendChild(a);
    }
    $('waTipGuide').textContent = payload
      ? 'Escolhe WhatsApp Business → O meu estado. ' + (payload.text
        ? 'Se a legenda ficar vazia, mantém o dedo no campo e toca em «Colar».'
        : 'Este navegador partilha só os ficheiros. Mantém o dedo no campo da legenda e toca em «Colar».') +
        ' Para publicar, toca na seta de envio no WhatsApp.'
      : manualGuide;
    note(payload ? 'Dica preparada para partilhar.' : 'A partilha direta está indisponível neste navegador. Podes descarregar os ficheiros.');
    controls();
  }
  function prepare() {
    const item = selected;
    if (!item || item.status !== 'ready') return;
    return work(current => {
      // Clipboard access needs this first tap. The second tap opens the share sheet.
      void copy(false);
      return prepareItem(item, current);
    }, 'Não foi possível preparar a dica. Atualiza a lista para verificar o registo.');
  }
  async function share() {
    const handoff = prepared;
    if (!authenticated || busy || !handoff?.payload || handoff.item !== selected) return;
    const seen = revision;
    // Invoke the picker during the user's tap, before doing any asynchronous work.
    busy = true;
    try {
      const opened = navigator.share(handoff.payload);
      controls();
      await opened;
      if (seen !== revision || prepared !== handoff) return;
      handoff.shared = true; handoff.review = true; handoff.payload = null;
      note('A janela de partilha fechou. Confirma a publicação só se vires a dica em «O meu estado».');
    } catch (error) {
      if (seen !== revision || prepared !== handoff) return;
      if (error?.name === 'AbortError') {
        handoff.canceled = true;
        note('A partilha foi cancelada ou não havia uma aplicação disponível. Podes tentar novamente, descarregar os ficheiros ou cancelar a tentativa se não enviaste a dica.');
      } else {
        handoff.payload = null; handoff.review = true;
        $('waTipGuide').textContent = 'Se a dica ainda não estiver no teu Estado, podes usar a opção de download. ' + manualGuide;
        note('O navegador não confirmou a partilha. Verifica o WhatsApp antes de repetir.');
      }
    } finally {
      if (seen === revision) { busy = false; options(); controls(); }
    }
  }
  function verify(observed) {
    const item = selected;
    const cancel = !observed && canCancel();
    if (!authenticated || busy || !(canReview() || cancel) || !confirm(observed ?
      'Viste esta dica publicada em «O meu estado» na conta AutoValorPT?' :
      cancel ? 'Confirmas que a dica não está no teu Estado e que ninguém a está a enviar noutro dispositivo? Ao cancelar, a dica fica disponível para preparar de novo.' :
      'Confirmas que a dica não está no teu Estado e que ninguém a está a enviar noutro dispositivo? Ao retomar, a aplicação volta a preparar a dica e a copiar a legenda.')) return;
    return work(async current => {
      if (!observed && !cancel) void copy(false);
      const result = await api(observed ? 'confirm' : 'release', { id: item.id, attemptId: item.attemptId,
        ...(observed ? { observed: true } : { notSent: true }) });
      if (!current()) return;
      if (result.status !== (observed ? 'confirmed' : 'ready') || result.attemptId !== item.attemptId) throw new Error('status_mismatch');
      item.status = result.status;
      clearFiles(); options();
      if (observed) { show(item); note('Dica registada como visível no teu Estado.'); }
      else if (cancel) note('Tentativa cancelada. Podes preparar a dica de novo quando quiseres.');
      else await prepareItem(item, current);
    }, 'Não foi possível confirmar o registo. Atualiza a lista antes de continuar.');
  }
  async function copy(link) {
    if (!authenticated || !selected) return;
    const value = link ? selected.simulatorUrl : $('waTipCaption').textContent;
    if (!value || link && !toolUrls.has(value)) return;
    const item = selected;
    try {
      await navigator.clipboard.writeText(value);
      if (item === selected) $('waTipCopyStatus').textContent = link ? 'Ligação copiada.' : 'Legenda copiada.';
    } catch {
      if (item !== selected) return;
      $('waTipText').open = true;
      $('waTipCopyStatus').textContent = link ? value : 'Para copiar manualmente, seleciona o texto em «Legenda completa para o Estado» e usa a opção «Copiar» antes de partilhar.';
    }
  }
  function openFromLink() { if (authenticated && location.hash === '#estado-whatsapp') panel.open = true; }
  panel.addEventListener('toggle', () => { if (authenticated && panel.open && Date.now() - lastListedAt >= 60000) void load(); });
  globalThis.addEventListener('hashchange', openFromLink);
  select.addEventListener('change', () => { if (!busy) show(items.find(item => item.id === select.value)); });
  $('waTipRefresh').addEventListener('click', load); $('waTipPrepare').addEventListener('click', prepare);
  $('waTipShare').addEventListener('click', share); $('waTipConfirm').addEventListener('click', () => verify(true));
  $('waTipRelease').addEventListener('click', () => verify(false));
  $('waTipCopy').addEventListener('click', () => copy(false)); $('waTipCopyLink').addEventListener('click', () => copy(true));
  globalThis.AutoValorWhatsappEditorial = {
    setSession(value, onExpiry) {
      revision++; authenticated = value; expire = onExpiry; busy = false; lastListedAt = 0;
      items = []; select.replaceChildren(); show(null); note('');
      if (!value) panel.open = false;
      else if (panel.open) void load();
      else openFromLink();
    },
  };
})();
