(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('estado-whatsapp'), select = $('waTipSelect');
  const stateLabels = { ready: 'Por partilhar', unconfirmed: 'Por confirmar', confirmed: 'Observada no Estado' };
  const toolUrls = new Set(['https://carregador.vercel.app/', 'https://credicarros.vercel.app/simulador-ano.html']);
  const { imageUrl, videoUrl, validDay } = globalThis.AutoValorEditorialPreview;
  let authenticated = false, expire, revision = 0, lastListedAt = 0, busy = false, items = [], selected, prepared;
  function note(text) { $('waTipMessage').textContent = text; }
  function clearFiles() {
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
      source.searchParams.sort(); expected.searchParams.sort();
      return source.href === expected.href;
    });
  }
  function canReview() {
    // Old reservations may already have reached WhatsApp on another device.
    return selected?.status === 'unconfirmed' && (!prepared || prepared.review);
  }
  function controls() {
    const item = selected;
    select.disabled = busy; $('waTipRefresh').disabled = busy || !authenticated;
    $('waTipPicker').hidden = !item;
    $('waTipPrepare').hidden = item?.status !== 'ready'; $('waTipPrepare').disabled = busy;
    $('waTipReview').hidden = !canReview();
    $('waTipReviewHint').textContent = prepared
      ? 'Depois de enviares, verifica se a dica ficou visível em «O meu estado» no WhatsApp Business da AutoValorPT.'
      : 'Ficou uma tentativa anterior por confirmar. Verifica «O meu estado» da AutoValorPT. Se a dica não está lá e não há outro envio em curso, toca em «Não enviei · retomar partilha».';
    $('waTipHandoff').hidden = !prepared || prepared.shared;
    $('waTipShare').hidden = !prepared?.files.length || prepared.shared || prepared.nativeFailed;
    $('waTipConfirm').disabled = $('waTipRelease').disabled = busy;
    $('waTipShare').disabled = busy;
  }
  function show(item) {
    clearFiles(); selected = item; $('waTipMedia').replaceChildren();
    $('waTipText').open = false; $('waTipCopyStatus').textContent = '';
    $('waTipCaption').textContent = item?.shareCaption || item?.caption || '';
    $('waTipCopy').disabled = !$('waTipCaption').textContent;
    $('waTipCopyLink').hidden = !toolUrls.has(item?.simulatorUrl);
    controls();
    if (!item) return;
    select.value = item.id;
    const first = item.media[0];
    const media = document.createElement(first.mime === 'video/mp4' ? 'video' : 'img');
    if (first.mime === 'video/mp4') { media.controls = true; media.playsInline = true; media.preload = 'none'; }
    else media.alt = item.title;
    media.src = first.url; $('waTipMedia').appendChild(media);
    if (item.media.length > 1) {
      const count = document.createElement('small'); count.textContent = 'Primeira de ' + item.media.length + ' imagens.';
      $('waTipMedia').appendChild(count);
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
  }
  function load() {
    return work(async current => {
      const id = selected?.id;
      note('A consultar as dicas publicadas…');
      const data = await api('list');
      if (!current()) return;
      if (!Array.isArray(data.items)) throw new Error('invalid_list');
      items = data.items.filter(available); lastListedAt = Date.now(); options(); show(items.find(item => item.id === id) || items[0]);
      if (!selected) note('Ainda não há dicas publicadas disponíveis para o Estado.');
    }, 'Não foi possível consultar as dicas. Toca em «Atualizar lista de dicas».');
  }
  function nameFor(item, index) {
    return 'AutoValorPT-' + item.date + (item.extra ? '-extra-' : '-dica-') + (index + 1) +
      (item.media[index].mime === 'video/mp4' ? '.mp4' : '.jpg');
  }
  async function filesFor(item) {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') return [];
    const supports = files => {
      try { return navigator.canShare({ files }); } catch { return false; }
    };
    const sample = item.media.map((media, i) => new File([' '], nameFor(item, i), { type: media.mime }));
    if (!supports(sample)) return [];
    const files = [];
    for (const [index, media] of item.media.entries()) {
      const response = await fetch(media.url, { credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(45000) });
      if (!response.ok || (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase() !== media.mime) throw new Error('media_unavailable');
      const blob = await response.blob();
      if (!blob.size) throw new Error('media_empty');
      files.push(new File([blob], nameFor(item, index), { type: media.mime }));
    }
    return supports(files) ? files : [];
  }
  async function prepareItem(item, current) {
    note('A preparar os ficheiros para o Estado…');
    let files = [];
    try { files = await filesFor(item); }
    catch {
      if (current()) note('Não foi possível carregar o ficheiro. Toca novamente em «Preparar dica para o Estado».');
      return;
    }
    if (!current()) return;
    const result = await api('claim', { id: item.id, requestId: crypto.randomUUID() });
    if (!current()) return;
    if (result.status !== 'unconfirmed' || !result.attemptId) throw new Error('claim_unconfirmed');
    item.status = result.status; item.attemptId = result.attemptId;
    const handoff = { item, files, review: false, shared: false, nativeFailed: false };
    prepared = handoff; options(); select.value = item.id;
    for (const [index, media] of item.media.entries()) {
      const a = document.createElement('a'); a.className = 'link'; a.href = media.url; a.download = nameFor(item, index);
      a.textContent = media.mime === 'video/mp4' ? 'Descarregar vídeo' : 'Descarregar imagem' + (item.media.length > 1 ? ' ' + (index + 1) : '');
      a.addEventListener('click', event => {
        if (busy || prepared !== handoff || !authenticated) { event.preventDefault(); return; }
        handoff.review = true;
        options(); controls();
        note('Depois de guardares o ficheiro, abre WhatsApp Business → Atualizações → Adicionar estado. Escolhe o ficheiro, cola a legenda e toca na seta de envio.');
      });
      $('waTipDownloads').appendChild(a);
    }
    $('waTipGuide').textContent = files.length
      ? 'Toca em «Partilhar no WhatsApp…». Na janela de partilha, escolhe WhatsApp Business → O meu estado e toca na seta de envio.'
      : 'Guarda o ficheiro em Fotografias. No WhatsApp Business, abre Atualizações → Adicionar estado, escolhe a dica e toca na seta de envio.';
    note(files.length ? 'Dica pronta para partilhar.' : 'A partilha direta está indisponível neste navegador. Usa a opção de download.');
    controls();
  }
  function prepare() {
    const item = selected;
    if (!item || item.status !== 'ready') return;
    return work(current => prepareItem(item, current), 'Não foi possível preparar a dica. Atualiza a lista para verificar o registo.');
  }
  async function share() {
    const handoff = prepared;
    if (!authenticated || busy || !handoff || handoff.item !== selected || !handoff.files.length || handoff.shared || handoff.nativeFailed) return;
    const seen = revision;
    // Invoke the picker during the user's tap, before doing any asynchronous work.
    busy = true;
    try {
      const opened = navigator.share({ files: handoff.files });
      controls();
      await opened;
      if (seen !== revision || prepared !== handoff) return;
      handoff.shared = true; handoff.review = true; handoff.files = [];
      note('A janela de partilha fechou. Confirma a publicação só se vires a dica em «O meu estado».');
    } catch (error) {
      if (seen !== revision || prepared !== handoff) return;
      if (error.name === 'AbortError') {
        note('A partilha foi cancelada ou não havia uma aplicação disponível. Se não enviaste, podes voltar a partilhar ou guardar o ficheiro.');
      } else {
        handoff.nativeFailed = true; handoff.review = true;
        $('waTipGuide').textContent = 'Se a dica não estiver no Estado, guarda o ficheiro em Fotografias. Abre WhatsApp Business → Atualizações → Adicionar estado e toca na seta de envio.';
        note('O navegador não confirmou a partilha. Verifica o WhatsApp antes de repetir.');
      }
    } finally {
      if (seen === revision) { busy = false; options(); controls(); }
    }
  }
  function verify(observed) {
    const item = selected;
    if (!authenticated || busy || !canReview() || !confirm(observed ?
      'Viste esta dica publicada em «O meu estado» na conta AutoValorPT?' :
      'Confirmas que a dica não está no teu Estado e que ninguém a está a enviar noutro dispositivo?')) return;
    return work(async current => {
      const result = await api(observed ? 'confirm' : 'release', { id: item.id, attemptId: item.attemptId,
        ...(observed ? { observed: true } : { notSent: true }) });
      if (!current()) return;
      if (result.status !== (observed ? 'confirmed' : 'ready')) throw new Error('status_mismatch');
      item.status = result.status; item.attemptId = result.attemptId;
      options(); show(item);
      if (observed) note('Dica registada como visível no teu Estado.');
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
      $('waTipText').open = true; $('waTipCopyStatus').textContent = link ? value : 'Seleciona a legenda acima para a copiar.';
    }
  }
  function openFromLink() { if (authenticated && location.hash === '#estado-whatsapp') panel.open = true; }
  panel.addEventListener('toggle', () => { if (authenticated && panel.open && !prepared && Date.now() - lastListedAt >= 60000) void load(); });
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
