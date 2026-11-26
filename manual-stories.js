(() => {
  'use strict';
  const host = document.getElementById('manualStories');
  if (!host) return;
  const collapsiblePreview = host.hasAttribute('data-collapsible-preview');
  const previewTag = collapsiblePreview ? 'details' : 'section';
  // Both private pages share the same controls. All data from the API is inserted as text.
  host.innerHTML = `
    <button class="ms-action ms-launch" id="chooseVehicle" type="button" aria-controls="vehiclePicker" aria-expanded="false" disabled>Criar vídeo de outra viatura</button>
    <div class="ms-picker" id="vehiclePicker" hidden>
      <label for="vehicleSearch">Escolher viatura</label>
      <input id="vehicleSearch" type="search" placeholder="Marca, modelo, ID ou matrícula" autocomplete="off" spellcheck="false">
      <p class="ms-detail">Seleciona uma viatura para preparar o vídeo.</p>
      <ul id="vehicleResults" class="ms-list" aria-label="Viaturas disponíveis"></ul>
    </div>
    <${previewTag} id="vehiclePreview" class="ms-preview" aria-labelledby="vehicleName" hidden>
      ${collapsiblePreview ? '<summary id="vehicleName">Vídeo preparado</summary>' : '<h2 id="vehicleName"></h2>'}
      <p id="vehicleDetails" class="ms-detail"></p>
      <video id="vehicleVideo" controls playsinline preload="metadata" aria-label="Pré-visualização do vídeo da viatura"></video>
      <div class="ms-actions">
        <a id="vehicleDownload" class="ms-action" download>Descarregar MP4</a>
        <button id="publishStory" class="ms-action ms-publish" type="button" disabled>Publicar Story agora</button>
      </div>
    </${previewTag}>
    <p id="vehicleStatus" class="ms-message" role="status" aria-live="polite"></p>
    <button id="resumeVideo" class="ms-action" type="button" hidden>Acompanhar vídeo</button>
    <div id="pendingVideos" class="ms-actions" role="group" aria-label="Vídeos por acompanhar" hidden></div>
    <div id="pendingStories" class="ms-actions"></div>
    <details id="manualRecovery" class="ms-recovery">
      <summary>Recuperar pedidos de vídeo e Stories</summary>
      <p id="manualRecoveryStatus" class="ms-message" role="status"></p>
      <ul id="recoveredVideos" class="ms-recovery-list" aria-label="Vídeos recuperados" hidden></ul>
      <ul id="recoveredStories" class="ms-recovery-list" aria-label="Stories recuperados" hidden></ul>
      <div class="ms-actions">
        <button id="loadRecovery" class="ms-action" type="button">Procurar pedidos</button>
        <button id="moreRecovery" class="ms-action" type="button" hidden>Procurar mais pedidos</button>
      </div>
    </details>
    <dialog id="confirmStory" class="ms-dialog" aria-labelledby="confirmStoryTitle" aria-describedby="confirmStoryText">
      <h2 id="confirmStoryTitle">Publicar o Story no Instagram?</h2><p id="confirmStoryText"></p>
      <div class="ms-actions"><button id="cancelStory" class="ms-action" type="button" autofocus>Voltar ao vídeo</button>
        <button id="sendStory" class="ms-action ms-publish" type="button">Confirmar publicação</button></div>
    </dialog>`;
  const $ = id => document.getElementById(id);
  const validId = /^ID[A-Za-z0-9]{5,30}$/;
  const validHash = /^[a-f0-9]{64}$/;
  const storageKey = 'autovalorpt.manual-stories.pending.v1';
  const publicationPrefix = 'autovalorpt.manual-story.receipt.';
  const maxStatusChecks = 48;
  const maxAutomaticResumes = 3;
  const preparationKey = 'autovalorpt.manual-video.preparation.v1';
  const preparationPrefix = 'autovalorpt.manual-video.preparation.v2.';
  const preparationInterval = 8000;
  const maxPreparationReads = 40;
  // The server gives each video job a five-minute lease.
  const maxPreparationFollowTime = 5 * 60_000 + 30_000;
  const validJob = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const recoverySources = [
    { action: 'video-recovery', list: 'recoveredVideos', video: true },
    { action: 'recovery', list: 'recoveredStories', video: false }
  ];
  const validCursor = value => typeof value === 'string' && /^[!-~]{1,1024}$/.test(value);
  const prices = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const sourceError = 'Não foi possível confirmar os dois inventários no Standvirtual. Volta a consultar o stock.';
  const reasons = {
    source_unavailable: sourceError, source_timeout: sourceError, source_empty_inventory: sourceError,
    source_invalid_vehicle: sourceError, source_incomplete_inventory: sourceError, source_schema_changed: sourceError,
    story_vehicle_unavailable: 'Esta viatura já não consta do stock. Abre novamente a lista.',
    stock_changed_during_render: 'O anúncio mudou enquanto o vídeo era preparado. Seleciona a viatura novamente.',
    stock_changed_before_publication: 'Os dados do anúncio mudaram. Seleciona a viatura para rever o vídeo atualizado.',
    story_manual_quota_reserved: 'O limite disponível no Instagram está reservado às publicações programadas. Tenta mais tarde.',
    story_preview_required: 'Seleciona novamente a viatura para preparar a pré-visualização.',
    video_render_failed: 'A criação do MP4 falhou. Seleciona a viatura para tentar de novo.',
    video_render_timeout: 'A criação do vídeo demorou demasiado. Podes tentar novamente.',
    video_budget_exhausted: 'A criação do vídeo demorou demasiado. Podes tentar novamente.',
    manual_video_job_interrupted: 'A criação do vídeo foi interrompida. Podes tentar novamente.',
    manual_video_job_expired: 'A ligação a este vídeo expirou. Prepara-o novamente para obter a versão atual.',
    manual_video_job_not_found: 'Este pedido de vídeo já não está disponível. Podes tentar novamente.',
    manual_video_job_invalid: 'Não foi possível recuperar este pedido. Prepara o vídeo novamente.',
    manual_video_job_failed: 'Não foi possível concluir o vídeo. Podes tentar novamente.',
    manual_video_job_unavailable: 'Não foi possível consultar o vídeo neste momento.',
    private_access_required: 'A sessão terminou. Entra novamente com o teu código privado.',
    production_required: 'Abre o painel de produção para preparar ou publicar um vídeo.',
    story_manual_review_expired: 'A confirmação expirou. Seleciona novamente a viatura para rever o vídeo atual.',
    story_manual_review_invalid: 'A confirmação não corresponde a este vídeo. Seleciona novamente a viatura.',
    stock_source_changed: 'O stock mudou desde a última sincronização. Carrega em «Atualizar tudo» no painel e volta a escolher a viatura.',
    stock_not_synchronized: 'O stock precisa de ser sincronizado. Carrega em «Atualizar tudo» no painel.',
    facebook_authorization_required: 'A autorização da Meta precisa de ser renovada.',
    story_permissions_required: 'A Meta ainda não autorizou a publicação de Stories.',
    story_container_not_ready: 'O Instagram não conseguiu preparar este vídeo. Revê o vídeo para tentar novamente.',
    story_container_failed: 'O Instagram não conseguiu receber o vídeo. Revê o vídeo para tentar novamente.',
    story_publishing_limit_reached: 'O Instagram atingiu o limite de publicações. Tenta mais tarde.',
    wrong_story_account: 'A conta ligada à Meta não corresponde a @autovalorpt.',
    video_signing_not_configured: 'A ligação privada ao vídeo precisa de configuração.',
    production_only: 'Abre o painel de produção para preparar ou publicar um vídeo.'
  };
  const outcomes = {
    ready: 'O servidor não registou um envio. Revê o vídeo antes de confirmar.',
    busy: 'O envio está em curso. Podes sair desta página e voltar para ver o resultado.',
    preparing: 'O envio precisa de ser retomado. Revê o vídeo e toca em «Continuar este envio».',
    review_required: 'O Instagram ainda não confirmou se o Story foi publicado.',
    published: 'O Instagram confirmou a publicação do Story.',
    failed: 'O envio falhou. Volta a selecionar a viatura para preparar uma nova tentativa.',
    canceled: 'A disponibilidade, os dados ou as fotografias mudaram. Volta a escolher a viatura.',
    disabled: 'A publicação manual está desativada. Podes descarregar o MP4.',
    authorization_required: 'A autorização da Meta precisa de verificação.'
  };
  let authenticated = false, onExpiry, notifyPending, sessionVersion = 0, busy = false;
  let stock = [], stockAt = 0, preview = null, phase = '', confirmation = null;
  let pending = new Map();
  let preparation = null, preparationTimer = null, preparationRequest = null, preparationVersion = 0, preparationReads = 0;
  let renderedPreparations = '';
  let recoveredPages = new Map(), recoveryBusy = false;

  function message(text = '', tone = '') {
    $('vehicleStatus').textContent = text;
    $('vehicleStatus').dataset.tone = tone;
  }
  function title(item) { return item.title || [item.brand, item.model].filter(Boolean).join(' '); }
  function lastPublished(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Intl.DateTimeFormat('pt-PT', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon'
    }).format(time) : '';
  }
  function price(item) {
    const match = /^(\d+(?:\.\d+)?) EUR$/.exec(item.price || '');
    return match ? prices.format(Number(match[1])) : '';
  }
  function normalized(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function validReceipt(value) {
    return value && validId.test(value.id) && validHash.test(value.fingerprint) &&
      typeof value.reviewToken === 'string' && value.reviewToken.length > 0 && value.reviewToken.length < 4096;
  }
  function receiptOf({ id, fingerprint, reviewToken }) { return { id, fingerprint, reviewToken }; }
  function sameAttempt(a, b) {
    return a && b && a.id === b.id && a.fingerprint === b.fingerprint &&
      a.reviewToken.split('.')[0] === b.reviewToken.split('.')[0];
  }
  function track(receipt) {
    const previous = pending.get(receipt.id);
    if (sameAttempt(previous, receipt)) return previous;
    clearTimeout(previous?.timer);
    const attempt = { ...receiptOf(receipt), remaining: maxStatusChecks, automaticResumes: 0 };
    pending.set(attempt.id, attempt);
    try {
      const key = publicationPrefix + attempt.id;
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (validReceipt(saved) && Number(saved.reviewToken.split('.')[0]) > Number(receipt.reviewToken.split('.')[0])) {
        Object.assign(attempt, receiptOf(saved));
      } else localStorage.setItem(key, JSON.stringify(receiptOf(attempt)));
    }
    catch { // Some private browsers only permit session storage.
      try { sessionStorage.setItem(storageKey, JSON.stringify([...pending.values()].map(receiptOf))); } catch {}
    }
    return attempt;
  }
  function finishAttempt(attempt) {
    clearTimeout(attempt.timer);
    pending.delete(attempt.id);
    try {
      const key = publicationPrefix + attempt.id;
      // If a newer attempt was written by another tab, keep its receipt.
      if (sameAttempt(JSON.parse(localStorage.getItem(key) || 'null'), attempt)) localStorage.removeItem(key);
    } catch {}
    try {
      if (sessionStorage.getItem(storageKey)) {
        if (pending.size) sessionStorage.setItem(storageKey, JSON.stringify([...pending.values()].map(receiptOf)));
        else sessionStorage.removeItem(storageKey);
      }
    } catch {}
  }
  function restoreAttempts(active) {
    try {
      if (!active) sessionStorage.removeItem(storageKey);
      else {
        const legacy = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
        if (Array.isArray(legacy)) {
          const receipts = legacy.filter(validReceipt);
          for (const receipt of receipts) track(receipt);
          if (receipts.every(receipt => localStorage.getItem(publicationPrefix + receipt.id))) sessionStorage.removeItem(storageKey);
        }
      }
    } catch {}
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (!key?.startsWith(publicationPrefix)) continue;
        if (!active) { localStorage.removeItem(key); continue; }
        const receipt = JSON.parse(localStorage.getItem(key));
        if (validReceipt(receipt) && key === publicationPrefix + receipt.id) track(receipt);
      }
    } catch {}
  }
  function queueStatus(attempt, delay = 8000) {
    clearTimeout(attempt.timer); attempt.timer = null;
    if (!authenticated || document.hidden || attempt.checking || attempt.sending ||
        pending.get(attempt.id) !== attempt || !attempt.remaining) return;
    attempt.timer = setTimeout(() => { attempt.timer = null; void checkAttempt(attempt); }, delay);
  }
  function canPublish() {
    return authenticated && !busy && preview?.publicationEnabled === true && !preview.mediaError &&
      !pending.get(preview.id)?.checking && !pending.get(preview.id)?.sending && $('vehicleVideo').readyState >= 1 && ['ready', 'preparing'].includes(phase);
  }
  function canPrepareAnother() {
    return authenticated && !busy && preview && ['published', 'canceled', 'failed', 'authorization_required'].includes(phase);
  }
  function updateControls() {
    $('chooseVehicle').disabled = !authenticated || busy;
    $('chooseVehicle').textContent = preparation && busy ? 'A criar o vídeo…' : 'Criar vídeo de outra viatura';
    $('resumeVideo').hidden = !authenticated || !preparation || busy;
    $('resumeVideo').disabled = !authenticated || busy;
    $('resumeVideo').textContent = preparation?.failed ? 'Tentar criar novamente' : 'Acompanhar vídeo';
    renderSavedPreparations();
    $('publishStory').disabled = !canPublish() && !canPrepareAnother();
    const labels = { published: 'Preparar novo Story desta viatura', preparing: 'Continuar este envio',
      busy: 'A aguardar o resultado', review_required: 'A aguardar o resultado' };
    $('publishStory').textContent = labels[phase] || (canPrepareAnother() ? 'Rever vídeo desta viatura' : 'Publicar Story agora');
    $('sendStory').disabled = !confirmation || !canPublish();
    for (const button of host.querySelectorAll('.ms-row, #pendingStories button')) button.disabled = busy;
    updateRecoveryControls();
  }
  function renderPending() {
    const container = $('pendingStories'); container.replaceChildren();
    for (const attempt of pending.values()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ms-action'; button.disabled = busy;
      const needsReview = attempt.status === 'preparing' && !attempt.autoEligible && (!sameAttempt(preview, attempt) || phase !== 'preparing');
      button.textContent = (needsReview ? 'Rever vídeo para continuar · ' : 'Consultar envio · ') + attempt.id;
      button.addEventListener('click', () => {
        if (busy || attempt.sending || attempt.checking) return;
        attempt.remaining = maxStatusChecks;
        if (needsReview) void openStock(attempt.id);
        else void checkAttempt(attempt);
      });
      container.appendChild(button);
    }
    notifyPending?.(pending.size);
  }
  function setPicker(open) {
    $('vehiclePicker').hidden = !open;
    $('chooseVehicle').setAttribute('aria-expanded', String(open));
  }
  function clearPreview() {
    if ($('confirmStory').open) $('confirmStory').close();
    preview = null; confirmation = null; phase = '';
    const player = $('vehicleVideo');
    if (player.hasAttribute('src')) { player.pause(); player.removeAttribute('src'); player.load(); }
    $('vehicleDownload').removeAttribute('href');
    $('vehicleName').textContent = collapsiblePreview ? 'Vídeo preparado' : '';
    $('vehicleDetails').textContent = '';
    $('vehiclePreview').hidden = true;
    if (collapsiblePreview) $('vehiclePreview').open = false;
  }
  function videoPath(value, id, fingerprint) {
    try {
      const link = new URL(value, location.origin);
      if (![location.origin, 'https://autovalorpt-assistente.vercel.app'].includes(link.origin) ||
          link.username || link.password || link.hash || link.pathname !== '/api/stock' ||
          link.searchParams.get('integration') !== 'instagram-video' || link.searchParams.get('id') !== id ||
          link.searchParams.get('fingerprint') !== fingerprint) return '';
      return link.pathname + link.search;
    } catch { return ''; }
  }
  function imageSource(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://ireland.apollo.olxcdn.com' && !url.username && !url.password && url.pathname.startsWith('/v1/files/') ? url.href : '';
    } catch { return ''; }
  }
  async function request(action, body, cursor) {
    const version = sessionVersion;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), action === 'publish' ? 20000 : 35000);
    try {
      const query = cursor ? '&cursor=' + encodeURIComponent(cursor) : '';
      const response = await fetch('/api/stock?integration=instagram-sync&action=stories-manual-' + action + query, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }), signal: controller.signal
      });
      if (response.status === 401 && version === sessionVersion) onExpiry?.();
      const data = await response.json().catch(() => null);
      if (!data || !response.ok) throw Object.assign(new Error(reasons[data?.error] || reasons[data?.reason] || 'O servidor não conseguiu concluir o pedido.'), { code: data?.error });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw Object.assign(new Error('O servidor demorou a responder.'), { code: 'connection_interrupted' });
      if (error.name === 'TypeError' || /^(Load failed|Failed to fetch|NetworkError.*)$/i.test(error.message || '')) {
        throw Object.assign(new Error('A ligação ao servidor foi interrompida.'), { code: 'connection_interrupted' });
      }
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function renderStock() {
    const list = $('vehicleResults'); list.replaceChildren();
    const words = $('vehicleSearch').value.trim().split(/\s+/).map(normalized).filter(Boolean);
    let count = 0;
    for (const item of stock) {
      const fields = [item.id, item.title, item.brand, item.model, item.plate].map(normalized);
      if (!words.every(word => fields.some(field => field.includes(word)))) continue;
      count++;
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'ms-row'; button.disabled = busy;
      const photo = document.createElement('span'), src = imageSource(item.image);
      if (src) {
        const image = document.createElement('img'); image.src = src; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
        photo.appendChild(image);
      }
      const info = document.createElement('span'), name = document.createElement('strong'), details = document.createElement('small');
      name.textContent = title(item);
      details.textContent = [price(item), item.id, item.plate, ...(Array.isArray(item.sources) ? item.sources : [])].filter(Boolean).join(' · ');
      info.append(name, details); button.append(photo, info); row.appendChild(button); list.appendChild(row);
      button.addEventListener('click', () => prepare(item));
    }
    message(count ? '' : stock.length ? 'Nenhuma viatura corresponde à pesquisa.' : 'Não há viaturas disponíveis nos dois inventários.');
  }
  async function loadStock() {
    if (stockAt && Date.now() - stockAt < 60000) return;
    const version = sessionVersion;
    const data = await request('stock');
    if (version !== sessionVersion) return;
    if (data.ok !== true || !Array.isArray(data.items)) throw new Error('Não foi possível confirmar as viaturas disponíveis.');
    stock = data.items.filter(item => validId.test(item?.id)); stockAt = Date.now();
  }
  async function openStock(id) {
    if (!authenticated || busy) return;
    const version = sessionVersion;
    clearPreview(); setPicker(true); busy = true; updateControls();
    $('vehicleResults').replaceChildren(); $('vehicleSearch').value = '';
    $('vehicleSearch').focus(); message('A consultar o stock da Samucar e da AutoValorPT…');
    let selected;
    try {
      await loadStock();
      if (version !== sessionVersion) return;
      renderStock();
      if (id) {
        selected = stock.find(item => item.id === id);
        if (!selected) message('Esta viatura já não consta do stock disponível. O MP4 guardado continua no histórico.');
      }
    } catch (error) {
      if (version === sessionVersion) { setPicker(false); message(error.message, 'error'); }
    } finally { if (version === sessionVersion) { busy = false; updateControls(); } }
    if (selected) await prepare(selected);
  }
  function isPreparationKey(key) {
    return key === preparationKey || key?.startsWith(preparationPrefix);
  }
  function readPreparationRecord(key) {
    try {
      const video = JSON.parse(localStorage.getItem(key) || 'null');
      if (video && typeof video.id === 'string' && validId.test(video.id) &&
          typeof video.title === 'string' && video.title.length <= 300 &&
          (!video.jobId || validJob.test(video.jobId)) && Number.isSafeInteger(video.startedAt) &&
          video.startedAt <= Date.now() + 60000 && Date.now() - video.startedAt < 24 * 3600000) {
        return { key, id: video.id, title: video.title, startedAt: video.startedAt,
          ...(video.jobId ? { jobId: video.jobId } : {}), ...(video.failed === true ? { failed: true } : {}) };
      }
    } catch { /* Ignore malformed or unavailable browser storage. */ }
    return null;
  }
  function savedPreparations(clear = false) {
    const saved = [];
    try {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index);
        if (!isPreparationKey(key)) continue;
        const job = clear ? null : readPreparationRecord(key);
        if (job) saved.push(job);
        else localStorage.removeItem(key);
      }
    } catch { /* Recovery remains available in memory when storage is disabled. */ }
    return saved.sort((a, b) => b.startedAt - a.startedAt);
  }
  function samePreparation(a, b) {
    return Boolean(a && a.key === b.key && a.id === b.id && a.startedAt === b.startedAt);
  }
  function savePreparation(job, isNew = false) {
    const { key, ...stored } = job;
    try {
      if (isNew || samePreparation(readPreparationRecord(key), job)) {
        localStorage.setItem(key, JSON.stringify(stored));
        return true;
      }
    } catch { /* Keep following the current request if storage is disabled. */ }
    return false;
  }
  function discardPreparation(job) {
    try {
      if (samePreparation(readPreparationRecord(job.key), job)) localStorage.removeItem(job.key);
    } catch { /* Ignore unavailable storage. */ }
  }
  function renderSavedPreparations() {
    const list = $('pendingVideos');
    const saved = authenticated && !busy
      ? savedPreparations().filter(job => !preparation || !samePreparation(job, preparation))
      : [];
    list.hidden = saved.length === 0;
    const signature = JSON.stringify(saved);
    if (signature === renderedPreparations) return;
    renderedPreparations = signature;
    list.replaceChildren();
    for (const job of saved) {
      const button = document.createElement('button');
      button.className = 'ms-action';
      button.type = 'button';
      button.textContent = (job.failed ? 'Tentar novamente · ' : 'Acompanhar · ') + job.title + ' (' + job.id + ')';
      button.addEventListener('click', () => {
        if (!authenticated || busy) return;
        const current = readPreparationRecord(job.key);
        if (!samePreparation(current, job)) { updateControls(); return; }
        clearPreview(); setPicker(false);
        preparation = current; preparationReads = 0;
        void resumePreparation();
      });
      list.appendChild(button);
    }
  }
  function stopPreparationPolling() {
    clearTimeout(preparationTimer); preparationTimer = null; preparationRequest = null; preparationVersion++;
  }
  function preparationMessage() {
    message('A criar o vídeo de ' + preparation.title + '… Podes sair desta página e voltar para acompanhar o resultado.');
  }
  function applyPreview(item, data) {
      const media = videoPath(data.videoUrl, item.id, data.fingerprint);
      const download = videoPath(data.downloadUrl, item.id, data.fingerprint);
      if (data.ok !== true || data.status !== 'preview_ready' || data.id !== item.id || !validReceipt(data) || !media || !download)
        throw new Error(reasons[data.reason] || outcomes[data.status] || 'O vídeo ainda não ficou pronto. Volta a selecionar a viatura.');
      const vehicle = data.vehicle?.id === item.id ? data.vehicle : item;
      preview = { ...receiptOf(data), publicationEnabled: data.publicationEnabled, title: title(vehicle), previous: lastPublished(data.previousPublishedAt) };
      const remotePhase = data.publicationStatus || 'ready';
      preview.initialPhase = remotePhase;
      if (validReceipt(data.pendingPublication) && data.pendingPublication.id === item.id) {
        track(data.pendingPublication);
      } else if (['preparing', 'busy', 'review_required'].includes(remotePhase)) {
        track(preview);
      }
      const previous = pending.get(item.id);
      phase = previous ? 'review_required' : remotePhase;
      if (previous) {
        previous.remaining = maxStatusChecks;
        renderPending(); queueStatus(previous, 0);
      }
      $('vehicleName').textContent = collapsiblePreview ? 'Vídeo preparado · ' + title(vehicle) : title(vehicle);
      $('vehicleDetails').textContent = [price(vehicle), item.id, '30 segundos', '1080 × 1920',
        preview.previous && 'Último Story manual em ' + preview.previous].filter(Boolean).join(' · ');
      $('vehicleVideo').src = media;
      $('vehicleDownload').href = download; $('vehicleDownload').download = 'AutoValorPT_' + item.id + '.mp4';
      $('vehiclePreview').hidden = false;
      if (collapsiblePreview) $('vehiclePreview').open = true;
      const readyMessage = collapsiblePreview ? '' : 'Carrega em reproduzir para rever o vídeo e confirmar o preço.';
      message(previous ? 'A verificar o resultado do envio anterior desta viatura…' :
        data.publicationEnabled ? readyMessage : outcomes.disabled);
      $('vehicleVideo').focus();
  }
  function preparationError(error) {
    clearTimeout(preparationTimer); preparationTimer = null;
    busy = false;
    if (preparation && ['manual_video_job_invalid', 'manual_video_job_not_found', 'manual_video_job_expired'].includes(error.code)) {
      preparation.failed = true; savePreparation(preparation);
    }
    message(error.message + (preparation && !preparation.failed ? ' Usa «Acompanhar vídeo» para consultar o mesmo pedido.' : ''), 'error');
    updateControls();
  }
  function canFollowPreparation() {
    return preparation && preparationReads < maxPreparationReads && Date.now() - preparation.startedAt < maxPreparationFollowTime;
  }
  function queuePreparationPoll(version, run) {
    clearTimeout(preparationTimer); preparationTimer = null;
    if (!authenticated || !preparation || preparationRequest || version !== sessionVersion || run !== preparationVersion) return;
    if (!canFollowPreparation()) {
      busy = false;
      message('A consulta automática terminou. Toca em «Acompanhar vídeo» para verificar este pedido.');
      updateControls();
      return;
    }
    if (document.hidden) return;
    preparationTimer = setTimeout(() => {
      preparationTimer = null;
      if (canFollowPreparation()) void readPreparation(version, run);
      else queuePreparationPoll(version, run);
    }, preparationInterval);
  }
  async function readPreparation(version = sessionVersion, run = preparationVersion) {
    if (!authenticated || !preparation?.jobId || preparationRequest || version !== sessionVersion || run !== preparationVersion) return;
    const job = preparation;
    const reading = {}; preparationRequest = reading; let pollAgain = false;
    preparationReads++;
    busy = true; updateControls();
    try {
      const data = await request('progress', { id: job.id, jobId: job.jobId });
      if (version !== sessionVersion || run !== preparationVersion || preparation !== job) return;
      if (data.id !== job.id || data.jobId !== job.jobId) throw new Error('Não foi possível confirmar o resultado deste vídeo.');
      if (data.ok === true && data.status === 'preparing') {
        preparationMessage(); pollAgain = true; return;
      }
      if (data.status === 'failed') {
        job.failed = true; savePreparation(job);
        throw new Error(reasons[data.reason] || reasons.manual_video_job_failed);
      }
      applyPreview(job, data);
      clearTimeout(preparationTimer); preparationTimer = null;
      discardPreparation(job); preparation = null; busy = false; updateControls();
    } catch (error) {
      if (version === sessionVersion && run === preparationVersion && preparation === job) preparationError(error);
    } finally {
      if (preparationRequest === reading) preparationRequest = null;
      if (pollAgain) queuePreparationPoll(version, run);
    }
  }
  async function startPreparation(item, previous) {
    const version = sessionVersion;
    stopPreparationPolling(); const run = preparationVersion;
    clearPreview(); setPicker(false);
    preparation = { key: preparationPrefix + crypto.randomUUID(), id: item.id, title: title(item), startedAt: Date.now() };
    preparationReads = 0;
    if (savePreparation(preparation, true) && previous) discardPreparation(previous);
    busy = true; updateControls(); preparationMessage();
    try {
      const data = await request('create', { id: item.id });
      if (version !== sessionVersion || run !== preparationVersion) return;
      if (data.ok !== true || data.status !== 'preparing' || data.id !== item.id || !validJob.test(data.jobId)) {
        throw new Error(reasons[data.reason] || 'Não foi possível confirmar o pedido de criação do vídeo.');
      }
      preparation.jobId = data.jobId; savePreparation(preparation);
      await readPreparation(version, run);
    } catch (error) {
      if (version === sessionVersion && run === preparationVersion) preparationError(error);
    }
  }
  async function prepare(item) {
    if (!authenticated || busy) return;
    await startPreparation(item);
  }
  async function resumePreparation() {
    if (!authenticated || busy || !preparation) return;
    if (preparation.failed || !preparation.jobId) return startPreparation(preparation, preparation);
    stopPreparationPolling(); preparationMessage();
    await readPreparation();
  }
  function updateRecoveryControls() {
    const disabled = !authenticated || busy || recoveryBusy;
    $('loadRecovery').disabled = disabled;
    $('moreRecovery').disabled = disabled;
    $('moreRecovery').hidden = !recoverySources.some(source => recoveredPages.get(source.action)?.cursor);
    for (const button of $('manualRecovery').querySelectorAll('li button')) button.disabled = disabled;
  }
  function renderRecovery() {
    for (const source of recoverySources) {
      const list = $(source.list);
      const items = recoveredPages.get(source.action)?.items || [];
      list.replaceChildren(); list.hidden = !items.length;
      for (const item of items) {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'ms-action';
        button.textContent = (source.video ? 'Acompanhar vídeo · ' : 'Consultar Story · ') + item.id;
        button.addEventListener('click', () => {
          if (!authenticated || busy || recoveryBusy) return;
          if (source.video) {
            clearPreview(); setPicker(false);
            const saved = savedPreparations().find(job => job.id === item.id && job.jobId === item.jobId);
            preparation = saved || { key: preparationPrefix + item.jobId, id: item.id, jobId: item.jobId,
              title: item.id, startedAt: Date.parse(item.startedAt) };
            preparationReads = 0;
            void resumePreparation();
          } else void inspectRecoveredStory(item);
        });
        row.appendChild(button); list.appendChild(row);
      }
    }
    updateRecoveryControls();
  }
  function recoveryItem(item, video) {
    if (!validId.test(item?.id)) return null;
    const { id, status } = item;
    if (video) {
      if (!validJob.test(item.jobId) || !['preparing', 'preview_ready'].includes(status) || !Number.isFinite(Date.parse(item.startedAt))) return null;
      return { id, jobId: item.jobId, startedAt: item.startedAt };
    }
    if (!Number.isSafeInteger(item.generation) || item.generation < 1 || item.generation > 99_999_999 ||
        !['busy', 'preparing', 'review_required'].includes(status)) return null;
    return { id, generation: item.generation };
  }
  async function loadRecovery(more = false) {
    if (!authenticated || busy || recoveryBusy) return;
    const sources = more ? recoverySources.filter(source => recoveredPages.get(source.action)?.cursor) : recoverySources;
    if (!sources.length) return;
    const version = sessionVersion;
    recoveryBusy = true; updateRecoveryControls();
    $('manualRecoveryStatus').textContent = 'A procurar pedidos no servidor…';
    const results = await Promise.allSettled(sources.map(source => request(source.action, undefined,
      more ? recoveredPages.get(source.action).cursor : undefined)));
    if (version !== sessionVersion) return;
    recoveryBusy = false;
    for (const [index, source] of sources.entries()) {
      const data = results[index].value;
      const previous = recoveredPages.get(source.action);
      if (!data?.ok || !Array.isArray(data.items) || data.items.length > 12 ||
          data.nextCursor !== null && (!validCursor(data.nextCursor) || more && data.nextCursor === previous?.cursor)) {
        recoveredPages.set(source.action, { items: previous?.items || [], cursor: previous?.cursor, partial: true });
        continue;
      }
      const items = new Map((more ? previous.items : []).map(item => [item.id, item]));
      let partial = data.partial === true || more && previous.partial;
      for (const row of data.items) {
        const item = recoveryItem(row, source.video);
        if (item) items.set(item.id, item);
        else partial = true;
      }
      recoveredPages.set(source.action, { items: [...items.values()], cursor: data.nextCursor, partial });
    }
    renderRecovery();
    const pages = [...recoveredPages.values()];
    $('manualRecoveryStatus').textContent = pages.some(page => page.partial) ? 'A consulta de alguns pedidos ficou incompleta. Podes voltar a procurar.'
      : pages.some(page => page.items.length) ? 'Escolhe um pedido para acompanhar o resultado.'
      : pages.some(page => page.cursor) ? 'Esta página de resultados está vazia. Podes procurar mais pedidos.'
      : 'Não foram encontrados pedidos pendentes.';
  }
  async function inspectRecoveredStory(item) {
    const version = sessionVersion;
    recoveryBusy = true; updateRecoveryControls();
    $('manualRecoveryStatus').textContent = 'A consultar o envio do Story…';
    try {
      const data = await request('recovery-status', item);
      if (version !== sessionVersion) return;
      if (data.id !== item.id || !Object.hasOwn(outcomes, data.status)) throw new Error('invalid_recovery_status');
      const note = data.status === 'ready' ? 'Este envio deixou de estar disponível neste registo.'
        : data.status === 'preparing' ? 'O envio precisa de ser retomado. Volta ao seletor de viaturas e revê o vídeo.'
          : outcomes[data.status];
      const date = data.status === 'published' && lastPublished(data.publishedAt);
      $('manualRecoveryStatus').textContent = item.id + ' · ' + note + (date ? ' ' + date + '.' : '');
    } catch {
      if (version === sessionVersion) $('manualRecoveryStatus').textContent = 'Não foi possível consultar o envio. Podes voltar a tentar.';
    } finally {
      if (version === sessionVersion) { recoveryBusy = false; updateRecoveryControls(); }
    }
  }
  function showOutcome(result, attempt, fromStatus = false) {
    if (pending.get(attempt.id) !== attempt) return;
    const status = result.id === attempt.id && Object.hasOwn(outcomes, result.status) ? result.status : 'review_required';
    if (fromStatus && status === 'ready') {
      // A read can reach another instance before the original POST has recorded its claim.
      attempt.firstMissingAt ??= Date.now();
      attempt.missingReads = (attempt.missingReads || 0) + 1;
      if (attempt.missingReads < 3 || Date.now() - attempt.firstMissingAt < 16000) {
        attempt.status = 'awaiting_receipt'; attempt.autoEligible = false;
        if (sameAttempt(preview, attempt)) phase = 'review_required';
        if (preview?.id === attempt.id || !preview && !busy)
          message(attempt.id + ' · O servidor ainda não registou o pedido. A verificar novamente…');
        updateControls(); queueStatus(attempt); return;
      }
    } else { attempt.firstMissingAt = undefined; attempt.missingReads = 0; }
    const unresolved = ['busy', 'preparing', 'review_required'].includes(status);
    attempt.status = status;
    // The server sets this flag only for an existing, confirmed container that
    // is still processing and whose original consent permits continuation.
    attempt.autoEligible = status === 'preparing' && result.canContinueAutomatically === true &&
      attempt.automaticResumes < maxAutomaticResumes;
    if (!unresolved) finishAttempt(attempt);
    const selected = preview?.id === attempt.id;
    const same = sameAttempt(preview, attempt);
    if (selected) {
      // A saved receipt may be for yesterday's already completed generation.
      // Only its own generation can update the review token or mark this preview published.
      phase = attempt.autoEligible ? 'busy' : status;
      if (!same) {
        phase = unresolved ? 'review_required' : preview.initialPhase;
        if (!unresolved && phase !== 'ready') phase = 'canceled';
      }
      if (same && phase === 'preparing' && validReceipt(result.pendingPublication) && sameAttempt(attempt, result.pendingPublication)) {
        preview.reviewToken = result.pendingPublication.reviewToken;
      }
    }
    renderPending(); updateControls();
    if (selected || (!preview && !busy && !preparation)) {
      const date = status === 'published' && lastPublished(result.publishedAt);
      const detail = attempt.autoEligible ? 'O Instagram ainda está a processar o vídeo. A publicação continua automaticamente.' : reasons[result.reason] || outcomes[status];
      message(attempt.id + ' · ' + (selected && !same ? 'Envio anterior. ' : '') + detail + (date ? ' ' + date : ''),
        status === 'published' ? 'success' : ['failed', 'canceled', 'authorization_required', 'review_required'].includes(status) ? 'error' : '');
    }
    if (attempt.autoEligible) {
      if (fromStatus && !document.hidden) {
        attempt.automaticResumes++;
        void sendPublication(attempt, receiptOf(attempt), true);
      } else queueStatus(attempt);
    } else if (status === 'busy' || status === 'review_required') {
      queueStatus(attempt, status === 'busy' ? 8000 : 15000);
    }
  }
  async function checkAttempt(attempt) {
    if (!authenticated || attempt.checking || attempt.sending || pending.get(attempt.id) !== attempt) return;
    const version = sessionVersion;
    clearTimeout(attempt.timer); attempt.timer = null; attempt.checking = true; attempt.remaining--; updateControls();
    let result;
    try {
      result = await request('status', receiptOf(attempt));
    } catch (error) {
      if (version !== sessionVersion || pending.get(attempt.id) !== attempt) return;
      if (error.code === 'story_manual_review_invalid') {
        showOutcome({ id: attempt.id, status: 'failed', reason: error.code }, attempt);
        return;
      }
      if (preview?.id === attempt.id || !preview && !busy) message(error.message + ' Podes voltar a consultar o envio.', 'error');
    } finally { attempt.checking = false; if (version === sessionVersion) updateControls(); }
    if (version !== sessionVersion || pending.get(attempt.id) !== attempt) return;
    if (result) showOutcome(result, attempt, true);
    else queueStatus(attempt, 15000);
  }
  async function publish(reviewed) {
    if (!canPublish() || reviewed !== preview) return;
    const receipt = receiptOf(reviewed), attempt = track(receipt);
    if (!sameAttempt(receipt, attempt)) {
      phase = 'review_required'; renderPending(); updateControls(); queueStatus(attempt, 0);
      message('Foi encontrado um envio mais recente. A consultar o resultado…'); return;
    }
    busy = true; phase = 'busy';
    attempt.remaining = maxStatusChecks; attempt.automaticResumes = 0;
    message('A pedir a publicação do Story em @autovalorpt. Podes voltar a esta página para ver o resultado.');
    await sendPublication(attempt, receipt, false);
  }
  async function sendPublication(attempt, receipt, automatic) {
    const version = sessionVersion;
    clearTimeout(attempt.timer); attempt.timer = null; attempt.sending = true;
    updateControls(); renderPending();
    let result;
    try {
      result = await request('publish', { ...receipt, confirmed: true, background: true, ...(automatic && { automatic: true }) });
    } catch (error) {
      if (version !== sessionVersion) return;
      if (automatic && error.code === 'story_manual_review_expired') {
        attempt.automaticResumes = maxAutomaticResumes;
      } else if (['story_manual_review_expired', 'story_manual_review_invalid'].includes(error.code)) {
        result = { id: receipt.id, status: 'failed', reason: error.code };
      } else if (sameAttempt(preview, receipt)) {
        phase = 'review_required'; message('O pedido ficou sem resposta. A verificar se o Instagram recebeu o envio…');
      }
    } finally {
      attempt.sending = false;
      if (version === sessionVersion) {
        if (!automatic) busy = false;
        updateControls();
      }
    }
    if (version !== sessionVersion) return;
    if (result) showOutcome(result, attempt);
    else queueStatus(attempt, 0);
  }
  $('chooseVehicle').addEventListener('click', () => {
    if ($('vehiclePicker').hidden) void openStock();
    else { setPicker(false); message(''); }
  });
  $('vehicleSearch').addEventListener('input', renderStock);
  $('resumeVideo').addEventListener('click', () => { void resumePreparation(); });
  $('loadRecovery').addEventListener('click', () => { void loadRecovery(); });
  $('moreRecovery').addEventListener('click', () => { void loadRecovery(true); });
  globalThis.addEventListener?.('storage', event => {
    if (event.key === null || isPreparationKey(event.key)) renderSavedPreparations();
  });
  document.addEventListener('visibilitychange', () => {
    for (const attempt of pending.values()) {
      clearTimeout(attempt.timer); attempt.timer = null;
      if (!document.hidden && (attempt.status !== 'preparing' || attempt.autoEligible)) { attempt.remaining = maxStatusChecks; queueStatus(attempt, 0); }
    }
    if (document.hidden) { clearTimeout(preparationTimer); preparationTimer = null; }
    else if (authenticated && preparation?.jobId && !preparation.failed && busy && !preparationTimer) {
      queuePreparationPoll(sessionVersion, preparationVersion);
    }
  });
  if (collapsiblePreview) $('vehiclePreview').addEventListener('toggle', () => {
    const player = $('vehicleVideo');
    if (!$('vehiclePreview').open && !player.paused) player.pause();
  });
  $('vehicleVideo').addEventListener('loadedmetadata', updateControls);
  $('vehicleVideo').addEventListener('error', () => {
    if (!preview || !$('vehicleVideo').error) return;
    preview.mediaError = true; updateControls(); message('O vídeo não abriu. Volta a selecionar a viatura para renovar a ligação ao MP4.', 'error');
  });
  $('publishStory').addEventListener('click', () => {
    if (canPrepareAnother()) {
      void openStock(preview.id);
      return;
    }
    if (!canPublish() || $('confirmStory').open) return;
    confirmation = preview;
    $('vehicleVideo').pause();
    const subject = preview.title + ' (' + preview.id + ')';
    const question = phase === 'preparing' ? 'Queres continuar o mesmo envio de ' + subject + ' para o Story de @autovalorpt?' :
      'Confirmas que reveste o vídeo de ' + subject + ' e queres publicá-lo no Story de @autovalorpt?';
    $('confirmStoryText').textContent = preview.previous ? 'O último Story manual desta viatura foi publicado em ' + preview.previous + '. ' + question : question;
    updateControls(); $('confirmStory').showModal();
  });
  $('cancelStory').addEventListener('click', () => $('confirmStory').close());
  $('confirmStory').addEventListener('close', () => { confirmation = null; updateControls(); });
  $('sendStory').addEventListener('click', () => {
    const reviewed = confirmation;
    if (!$('confirmStory').open || !canPublish() || !reviewed || reviewed !== preview) return;
    confirmation = null; $('confirmStory').close(); void publish(reviewed);
  });
  globalThis.AutoValorManualStories = {
    selectAvailable(id) {
      if (!validId.test(id)) return;
      host.scrollIntoView({ block: 'start' }); void openStock(id);
    },
    setSession(active, expire, onPendingChange = notifyPending, { preserveRecovery = false } = {}) {
      authenticated = active; onExpiry = expire; sessionVersion++; busy = false;
      stopPreparationPolling(); preparation = null; preparationReads = 0;
      recoveredPages = new Map(); recoveryBusy = false;
      $('manualRecovery').open = false; $('manualRecoveryStatus').textContent = '';
      renderRecovery();
      notifyPending = onPendingChange;
      for (const attempt of pending.values()) clearTimeout(attempt.timer);
      clearPreview(); setPicker(false); message(''); stock = []; stockAt = 0; pending = new Map();
      $('vehicleResults').replaceChildren(); $('vehicleSearch').value = '';
      if (active || !preserveRecovery) restoreAttempts(active);
      const saved = active ? savedPreparations() : [];
      if (saved.length === 1) preparation = saved[0];
      if (!active && !preserveRecovery) savedPreparations(true);
      for (const attempt of pending.values()) queueStatus(attempt, 0);
      renderPending(); updateControls();
      if (active && preparation) {
        message('Tens um pedido de vídeo de ' + preparation.title + '. Podes acompanhar o resultado.');
        if (preparation.jobId && !preparation.failed && canFollowPreparation()) void resumePreparation();
      }
      if (saved.length > 1) message('Tens vários pedidos de vídeo. Escolhe qual queres acompanhar.');
      if (!active) notifyPending = undefined;
    }
  };
})();
