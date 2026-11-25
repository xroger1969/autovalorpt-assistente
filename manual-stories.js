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
    <div id="pendingStories" class="ms-actions"></div>
    <dialog id="confirmStory" class="ms-dialog" aria-labelledby="confirmStoryTitle" aria-describedby="confirmStoryText">
      <h2 id="confirmStoryTitle">Publicar o Story no Instagram?</h2><p id="confirmStoryText"></p>
      <div class="ms-actions"><button id="cancelStory" class="ms-action" type="button" autofocus>Voltar ao vídeo</button>
        <button id="sendStory" class="ms-action ms-publish" type="button">Confirmar publicação</button></div>
    </dialog>`;
  const $ = id => document.getElementById(id);
  const validId = /^ID[A-Za-z0-9]{5,30}$/;
  const validHash = /^[a-f0-9]{64}$/;
  const storageKey = 'autovalorpt.manual-stories.pending.v1';
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
    production_required: 'Abre o painel de produção para preparar ou publicar um vídeo.',
    story_manual_review_expired: 'A confirmação expirou. Seleciona novamente a viatura para rever o vídeo atual.',
    story_manual_review_invalid: 'A confirmação não corresponde a este vídeo. Seleciona novamente a viatura.',
    stock_source_changed: 'O stock mudou desde a última sincronização. Carrega em «Atualizar tudo» no painel e volta a escolher a viatura.',
    stock_not_synchronized: 'O stock precisa de ser sincronizado. Carrega em «Atualizar tudo» no painel.',
    facebook_authorization_required: 'A autorização da Meta precisa de ser renovada.',
    story_permissions_required: 'A Meta ainda não autorizou a publicação de Stories.',
    story_publishing_limit_reached: 'O Instagram atingiu o limite de publicações. Tenta mais tarde.',
    wrong_story_account: 'A conta ligada à Meta não corresponde a @autovalorpt.',
    video_signing_not_configured: 'A ligação privada ao vídeo precisa de configuração.',
    production_only: 'Abre o painel de produção para preparar ou publicar um vídeo.'
  };
  const outcomes = {
    ready: 'O servidor não registou um envio. Revê o vídeo antes de confirmar.',
    busy: 'O pedido já está em curso. Consulta o envio para acompanhar o resultado.',
    preparing: 'O Instagram está a preparar este vídeo. Podes continuar o mesmo envio após o rever.',
    review_required: 'A Meta ainda não confirmou o resultado. Consulta o envio antes de voltar a publicar.',
    published: 'O Instagram confirmou a publicação do Story.',
    failed: 'O envio falhou. Volta a selecionar a viatura para preparar uma nova tentativa.',
    canceled: 'A disponibilidade, os dados ou as fotografias mudaram. Volta a escolher a viatura.',
    disabled: 'A publicação manual está desativada. Podes descarregar o MP4.',
    authorization_required: 'A autorização da Meta precisa de verificação.'
  };
  let authenticated = false, onExpiry, notifyPending, sessionVersion = 0, busy = false;
  let stock = [], stockAt = 0, preview = null, phase = '', confirmation = null;
  let pending = new Map();

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
  function storePending() {
    try {
      if (pending.size) sessionStorage.setItem(storageKey, JSON.stringify([...pending.values()]));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The in-memory receipt remains available in private browsing. */ }
  }
  function canPublish() {
    return authenticated && !busy && preview?.publicationEnabled === true && !preview.mediaError && $('vehicleVideo').readyState >= 1 && ['ready', 'preparing'].includes(phase);
  }
  function updateControls() {
    $('chooseVehicle').disabled = !authenticated || busy;
    $('publishStory').disabled = !canPublish();
    $('publishStory').textContent = phase === 'preparing' ? 'Continuar este envio' : 'Publicar Story agora';
    $('sendStory').disabled = !confirmation || !canPublish();
    for (const button of host.querySelectorAll('.ms-row, #pendingStories button')) button.disabled = busy;
  }
  function renderPending() {
    const container = $('pendingStories'); container.replaceChildren();
    for (const attempt of pending.values()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'ms-action'; button.disabled = busy;
      button.textContent = 'Consultar envio · ' + attempt.id;
      button.addEventListener('click', () => checkAttempt(attempt));
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
  async function request(action, body) {
    const version = sessionVersion;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), action === 'preview' ? 305000 : action === 'publish' ? 285000 : 90000);
    try {
      const response = await fetch('/api/stock?integration=instagram-sync&action=stories-manual-' + action, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
        ...(body && { body: JSON.stringify(body) }), signal: controller.signal
      });
      if (response.status === 401 && version === sessionVersion) onExpiry?.();
      const data = await response.json().catch(() => null);
      if (!data || !response.ok) throw Object.assign(new Error(reasons[data?.error] || reasons[data?.reason] || 'O servidor não conseguiu concluir o pedido.'), { code: data?.error });
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('O pedido ficou sem resposta e pode continuar em processamento.');
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
  async function prepare(item) {
    if (!authenticated || busy) return;
    const version = sessionVersion;
    clearPreview(); setPicker(false); busy = true; updateControls();
    message('A preparar o vídeo de ' + title(item) + '… Pode demorar alguns minutos.');
    try {
      const data = await request('preview', { id: item.id });
      if (version !== sessionVersion) return;
      const media = videoPath(data.videoUrl, item.id, data.fingerprint);
      const download = videoPath(data.downloadUrl, item.id, data.fingerprint);
      if (data.ok !== true || data.status !== 'preview_ready' || data.id !== item.id || !validReceipt(data) || !media || !download)
        throw new Error(reasons[data.reason] || outcomes[data.status] || 'O vídeo ainda não ficou pronto. Volta a selecionar a viatura.');
      const vehicle = data.vehicle?.id === item.id ? data.vehicle : item;
      preview = { ...receiptOf(data), publicationEnabled: data.publicationEnabled, title: title(vehicle), previous: lastPublished(data.previousPublishedAt) };
      const remotePhase = data.publicationStatus || 'ready';
      if (validReceipt(data.pendingPublication) && data.pendingPublication.id === item.id) {
        pending.set(item.id, receiptOf(data.pendingPublication)); storePending(); renderPending();
      } else if (['preparing', 'busy', 'review_required'].includes(remotePhase) &&
          (!pending.has(item.id) || pending.get(item.id).fingerprint === preview.fingerprint)) {
        pending.set(item.id, receiptOf(preview)); storePending(); renderPending();
      }
      const previous = pending.get(item.id);
      phase = previous ? 'review_required' : remotePhase;
      $('vehicleName').textContent = collapsiblePreview ? 'Vídeo preparado · ' + title(vehicle) : title(vehicle);
      $('vehicleDetails').textContent = [price(vehicle), item.id, '30 segundos', '1080 × 1920',
        preview.previous && 'Último Story manual em ' + preview.previous].filter(Boolean).join(' · ');
      $('vehicleVideo').src = media;
      $('vehicleDownload').href = download; $('vehicleDownload').download = 'AutoValorPT_' + item.id + '.mp4';
      $('vehiclePreview').hidden = false;
      if (collapsiblePreview) $('vehiclePreview').open = true;
      const readyMessage = collapsiblePreview ? '' : 'Carrega em reproduzir para rever o vídeo e confirmar o preço.';
      message(previous ? 'Há um envio anterior desta viatura. Consulta o resultado antes de publicar.' :
        data.publicationEnabled ? readyMessage : outcomes.disabled);
      $('vehicleVideo').focus();
    } catch (error) {
      if (version === sessionVersion) { stockAt = 0; message(error.message, 'error'); }
    } finally { if (version === sessionVersion) { busy = false; updateControls(); } }
  }
  function showOutcome(result, attempt) {
    const status = result.id === attempt.id && Object.hasOwn(outcomes, result.status) ? result.status : 'review_required';
    const unresolved = ['busy', 'preparing', 'review_required'].includes(status);
    if (!unresolved) pending.delete(attempt.id);
    storePending(); renderPending();
    const differentVideo = preview?.id === attempt.id && preview.fingerprint !== attempt.fingerprint;
    if (preview?.id === attempt.id) {
      phase = differentVideo ? 'review_required' : status;
      if (phase === 'preparing') preview.reviewToken = attempt.reviewToken;
    }
    const detail = differentVideo ? 'Envio do vídeo anterior. ' + (reasons[result.reason] || outcomes[status]) +
      ' Seleciona novamente a viatura para rever o vídeo atual.' : reasons[result.reason] || outcomes[status];
    message(attempt.id + ' · ' + detail, status === 'published' ? 'success' : unresolved || ['failed', 'canceled', 'authorization_required'].includes(status) ? 'error' : '');
  }
  async function checkAttempt(attempt) {
    if (!authenticated || busy) return;
    const version = sessionVersion; busy = true; updateControls(); message('A consultar o envio de ' + attempt.id + '…');
    try {
      const result = await request('status', receiptOf(attempt));
      if (sessionVersion === version) showOutcome(result, attempt);
    } catch (error) {
      if (sessionVersion === version) message(error.message + ' Podes voltar a consultar o envio.', 'error');
    } finally { if (sessionVersion === version) { busy = false; updateControls(); } }
  }
  async function publish(attempt) {
    if (!canPublish() || attempt !== preview) return;
    const version = sessionVersion;
    busy = true; phase = 'busy'; updateControls();
    const receipt = receiptOf(attempt);
    pending.set(receipt.id, receipt); storePending(); renderPending();
    message('A enviar o Story para @autovalorpt. Aguarda a confirmação…');
    try {
      const result = await request('publish', { ...receipt, confirmed: true });
      if (version === sessionVersion) showOutcome(result, receipt);
    } catch (error) {
      if (version !== sessionVersion) return;
      if (['story_manual_review_expired', 'story_manual_review_invalid'].includes(error.code)) {
        pending.delete(receipt.id); storePending(); renderPending(); phase = 'failed'; message(error.message, 'error');
      } else {
        phase = 'review_required'; message('O envio ficou sem confirmação. Consulta o envio para saber o resultado.', 'error');
      }
    } finally { if (version === sessionVersion) { busy = false; updateControls(); } }
  }
  $('chooseVehicle').addEventListener('click', () => {
    if ($('vehiclePicker').hidden) void openStock();
    else { setPicker(false); message(''); }
  });
  $('vehicleSearch').addEventListener('input', renderStock);
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
    setSession(active, expire, onPendingChange = notifyPending) {
      authenticated = active; onExpiry = expire; sessionVersion++; busy = false;
      notifyPending = onPendingChange;
      clearPreview(); setPicker(false); message(''); stock = []; stockAt = 0; pending = new Map();
      $('vehicleResults').replaceChildren(); $('vehicleSearch').value = '';
      if (active) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
          if (Array.isArray(saved)) for (const item of saved.filter(validReceipt)) pending.set(item.id, receiptOf(item));
        } catch { /* Ignore unavailable storage. */ }
      } else storePending();
      renderPending(); updateControls();
      if (!active) notifyPending = undefined;
    }
  };
})();
