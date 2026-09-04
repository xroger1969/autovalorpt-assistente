(() => {
  'use strict';

  const DRAFT_KEY = 'autovalorpt-retoma-fotos-v1';
  const MAX_PHOTOS = 10;
  const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
  const MAX_IMAGE_EDGE = 1800;
  const JPEG_QUALITY = 0.82;
  const ALLOWED_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]);

  const photoState = {
    batchId: '',
    viewerToken: '',
    galleryUrl: '',
    fingerprint: '',
    count: 0,
    status: 'idle',
    dismissed: false,
    message: '',
    previewUrls: [],
    uploadGeneration: 0
  };

  function currentFingerprint() {
    return [state?.vehicle?.title || state?.lead?.viatura || '', state?.lead?.retoma || '', state?.lead?.matricula || '']
      .map((value) => String(value || '').trim())
      .join('|');
  }

  function saveDraft() {
    try {
      if (!photoState.fingerprint) return sessionStorage.removeItem(DRAFT_KEY);
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        batchId: photoState.batchId,
        viewerToken: photoState.viewerToken,
        galleryUrl: photoState.galleryUrl,
        fingerprint: photoState.fingerprint,
        count: photoState.count,
        dismissed: photoState.dismissed
      }));
    } catch {}
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft || Date.now() - Number(draft.savedAt || 0) > 2 * 60 * 60 * 1000) return;
      if (!draft.fingerprint || draft.fingerprint !== currentFingerprint()) return;
      photoState.batchId = String(draft.batchId || '');
      photoState.viewerToken = String(draft.viewerToken || '');
      photoState.galleryUrl = String(draft.galleryUrl || '');
      photoState.fingerprint = String(draft.fingerprint || '');
      photoState.count = Math.min(MAX_PHOTOS, Math.max(0, Number(draft.count || 0)));
      photoState.dismissed = Boolean(draft.dismissed);
      photoState.status = photoState.count ? 'complete' : 'idle';
    } catch {}
  }

  function clearPhotoState() {
    photoState.uploadGeneration += 1;
    photoState.batchId = '';
    photoState.viewerToken = '';
    photoState.galleryUrl = '';
    photoState.fingerprint = '';
    photoState.count = 0;
    photoState.status = 'idle';
    photoState.dismissed = false;
    photoState.message = '';
    photoState.previewUrls = [];
    try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
    document.getElementById('photoUploadCard')?.remove();
  }

  function injectStyles() {
    if (document.getElementById('photoUploadStyles')) return;
    const style = document.createElement('style');
    style.id = 'photoUploadStyles';
    style.textContent = `
      .photo-upload-card{margin:8px 0 17px;padding:18px;border:1px solid #b8d8ff;border-radius:22px;background:linear-gradient(145deg,#f7fbff,#eef6ff);box-shadow:0 10px 28px rgba(11,94,215,.08)}
      .photo-upload-head{display:flex;align-items:flex-start;gap:12px}.photo-upload-icon{width:44px;height:44px;flex:0 0 44px;border-radius:14px;display:grid;place-items:center;background:#0b5ed7;color:#fff;font-size:22px;box-shadow:0 8px 18px rgba(11,94,215,.20)}
      .photo-upload-title{margin:1px 0 4px;color:#123f7b;font-size:18px;font-weight:950;line-height:1.25}.photo-upload-copy{margin:0;color:#52647c;font-size:14px;line-height:1.48}
      .photo-upload-guide{margin:14px 0 0;padding:11px 13px;border:1px solid #d6e7fa;border-radius:14px;background:rgba(255,255,255,.82);color:#45566d;font-size:13px;line-height:1.45}
      .photo-upload-actions{display:flex;gap:9px;margin-top:14px;align-items:stretch}.photo-upload-primary,.photo-upload-secondary,.photo-gallery-link{min-height:48px;padding:0 16px;border-radius:14px;font-weight:900;font-size:14px;cursor:pointer}
      .photo-upload-primary{flex:1;border:0;background:linear-gradient(135deg,#0b6ff5,#0755c7);color:#fff;box-shadow:0 9px 20px rgba(11,94,215,.18)}.photo-upload-primary:disabled{opacity:.62;cursor:wait}
      .photo-upload-secondary{border:1px solid #c8dbf2;background:#fff;color:#52647c}.photo-gallery-link{border:1px solid #a9d8c2;background:#effaf5;color:#087348;text-decoration:none;display:grid;place-items:center}
      .photo-upload-status{margin-top:12px;color:#465c76;font-size:14px;font-weight:800;line-height:1.4}.photo-upload-status.success{color:#087348}.photo-upload-status.error{color:#a13535}
      .photo-progress{height:8px;margin-top:9px;overflow:hidden;border-radius:999px;background:#dbe8f7}.photo-progress>span{display:block;height:100%;width:0;border-radius:inherit;background:linear-gradient(90deg,#0b6ff5,#32a172);transition:width .25s ease}
      .photo-preview-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:13px}.photo-preview{position:relative;aspect-ratio:1;overflow:hidden;border:1px solid #d2e2f3;border-radius:11px;background:#e5eef8}.photo-preview img{width:100%;height:100%;display:block;object-fit:cover}.photo-preview.unavailable::after{content:"Foto";position:absolute;inset:0;display:grid;place-items:center;color:#52647c;font-size:11px;font-weight:850}
      .photo-summary-row{border-top:1px solid #e5ecf4;padding-top:8px;margin-top:2px}
      @media(max-width:820px){.photo-upload-card{padding:18px;margin:9px 0 19px;border-radius:23px}.photo-upload-title{font-size:20px}.photo-upload-copy{font-size:16px}.photo-upload-guide{font-size:14px}.photo-upload-actions{display:grid;grid-template-columns:1fr}.photo-upload-primary,.photo-upload-secondary,.photo-gallery-link{min-height:58px;font-size:17px}.photo-preview-grid{grid-template-columns:repeat(5,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  async function requestJson(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `Erro ${response.status}`);
        error.status = response.status;
        error.code = data.code || '';
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function createSession() {
    if (photoState.batchId && photoState.viewerToken) return;
    const data = await requestJson('/api/photo-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vehicle: state?.vehicle?.title || state?.lead?.viatura || '',
        tradeIn: state?.lead?.retoma || '',
        registration: state?.lead?.matricula || ''
      })
    });
    photoState.batchId = data.batchId;
    photoState.viewerToken = data.viewerToken;
    photoState.galleryUrl = data.galleryUrl;
    photoState.fingerprint = currentFingerprint();
    saveDraft();
  }

  async function refreshGallery() {
    if (!photoState.batchId || !photoState.viewerToken) return null;
    const query = new URLSearchParams({
      batch: photoState.batchId,
      token: photoState.viewerToken
    });
    const data = await requestJson(`/api/photo-gallery?${query.toString()}`, {}, 20000);
    photoState.count = Math.min(MAX_PHOTOS, Array.isArray(data.photos) ? data.photos.length : 0);
    photoState.previewUrls = (data.photos || []).map((photo) => photo.url).filter(Boolean);
    if (photoState.count) photoState.status = 'complete';
    saveDraft();
    return data;
  }

  function normalizeFileType(file) {
    const type = String(file?.type || '').toLowerCase().split(';')[0];
    if (ALLOWED_TYPES.has(type)) return type;
    const extension = String(file?.name || '').split('.').pop()?.toLowerCase();
    return {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif'
    }[extension] || '';
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close() {} });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Formato não processável.'));
      };
      image.src = url;
    });
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in window) {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
      } catch {}
    }
    return loadImage(file);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível comprimir a fotografia.')), 'image/jpeg', JPEG_QUALITY);
    });
  }

  async function preparePhoto(file) {
    const originalType = normalizeFileType(file);
    if (!originalType) throw new Error('Só são aceites fotografias JPG, PNG, WebP ou HEIC.');

    try {
      const decoded = await decodeImage(file);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      decoded.close();
      const blob = await canvasToBlob(canvas);
      if (blob.size > MAX_PHOTO_BYTES) throw new Error('A fotografia continua demasiado grande depois da compressão.');
      return { blob, contentType: 'image/jpeg' };
    } catch (error) {
      if (file.size > MAX_PHOTO_BYTES) throw error;
      return { blob: file, contentType: originalType };
    }
  }

  async function uploadPreparedPhoto(prepared, index) {
    const authorization = await requestJson('/api/photo-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: photoState.batchId,
        viewerToken: photoState.viewerToken,
        contentType: prepared.contentType,
        size: prepared.blob.size,
        index
      })
    });
    const response = await fetch(authorization.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': prepared.contentType },
      body: prepared.blob
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      const error = new Error(details || 'Falha no envio da fotografia.');
      error.status = response.status;
      throw error;
    }
  }

  function setProgress(completed, total) {
    const progress = document.querySelector('#photoUploadCard .photo-progress span');
    if (progress) progress.style.width = `${Math.round((completed / Math.max(1, total)) * 100)}%`;
  }

  async function handleFiles(fileList) {
    const selected = [...fileList].filter((file) => normalizeFileType(file));
    const remaining = MAX_PHOTOS - photoState.count;
    if (!selected.length) {
      photoState.status = 'error';
      photoState.message = 'Escolha fotografias nos formatos JPG, PNG, WebP ou HEIC.';
      return renderPhotoCard();
    }
    if (remaining <= 0) {
      photoState.status = 'complete';
      photoState.message = 'Já foram recebidas 10 fotografias.';
      return renderPhotoCard();
    }

    const files = selected.slice(0, remaining);
    const generation = ++photoState.uploadGeneration;
    photoState.status = 'uploading';
    photoState.message = `A preparar ${files.length} ${files.length === 1 ? 'fotografia' : 'fotografias'}…`;
    renderPhotoCard();
    setProgress(0, files.length);

    let uploaded = 0;
    let failed = 0;
    try {
      await createSession();
      await refreshGallery().catch(() => null);

      for (const file of files.slice(0, MAX_PHOTOS - photoState.count)) {
        if (generation !== photoState.uploadGeneration) return;
        const index = photoState.count + 1;
        photoState.message = `A enviar fotografia ${uploaded + 1} de ${files.length}…`;
        renderPhotoCard();
        setProgress(uploaded, files.length);
        try {
          const prepared = await preparePhoto(file);
          await uploadPreparedPhoto(prepared, index);
          photoState.count += 1;
          uploaded += 1;
        } catch (error) {
          if (error?.status === 409) {
            await refreshGallery().catch(() => null);
            if (photoState.count >= index) uploaded += 1;
            else failed += 1;
          } else {
            failed += 1;
          }
        }
        saveDraft();
        setProgress(uploaded + failed, files.length);
      }

      await refreshGallery().catch(() => null);
      photoState.status = photoState.count ? 'complete' : 'error';
      photoState.message = failed
        ? `${photoState.count} ${photoState.count === 1 ? 'fotografia recebida' : 'fotografias recebidas'}. ${failed} não ${failed === 1 ? 'foi enviada' : 'foram enviadas'}.`
        : `${photoState.count} ${photoState.count === 1 ? 'fotografia recebida' : 'fotografias recebidas'} com sucesso.`;
    } catch (error) {
      photoState.status = 'error';
      photoState.message = error?.code === 'storage_not_configured'
        ? 'O arquivo de fotografias ainda está a ser preparado. Pode continuar o pedido normalmente.'
        : (error?.message || 'Não foi possível enviar as fotografias. Tente novamente.');
    }

    saveDraft();
    renderPhotoCard();
    renderSummary();
    document.querySelectorAll('.followup-main').forEach((link) => { link.href = whatsappUrl(); });
  }

  function renderPreviews(card) {
    if (!photoState.previewUrls.length) return;
    const grid = document.createElement('div');
    grid.className = 'photo-preview-grid';
    photoState.previewUrls.slice(0, MAX_PHOTOS).forEach((url, index) => {
      const tile = document.createElement('div');
      tile.className = 'photo-preview';
      const image = document.createElement('img');
      image.src = url;
      image.alt = `Fotografia ${index + 1} da retoma`;
      image.loading = 'lazy';
      image.onerror = () => {
        image.remove();
        tile.classList.add('unavailable');
      };
      tile.appendChild(image);
      grid.appendChild(tile);
    });
    card.appendChild(grid);
  }

  function renderPhotoCard() {
    const existing = document.getElementById('photoUploadCard');
    if (existing) existing.remove();
    const tradeIn = String(state?.lead?.retoma || '').trim();
    const validateTradeIn = globalThis.AutoValorValidation?.validateTradeIn;
    const completeTradeIn = tradeIn && (
      typeof validateTradeIn !== 'function' ||
      validateTradeIn(tradeIn).ok
    );
    if (!state?.vehicle || !completeTradeIn || !state?.lead?.matricula || (photoState.dismissed && !photoState.count)) return;

    const card = document.createElement('section');
    card.id = 'photoUploadCard';
    card.className = 'photo-upload-card';
    card.setAttribute('aria-label', 'Enviar fotografias da retoma');

    const head = document.createElement('div');
    head.className = 'photo-upload-head';
    head.innerHTML = `
      <div class="photo-upload-icon" aria-hidden="true">📷</div>
      <div>
        <h3 class="photo-upload-title">Enviar fotografias da sua viatura</h3>
        <p class="photo-upload-copy">Opcional — ajuda-nos a preparar uma avaliação mais rigorosa da retoma.</p>
      </div>
    `;
    card.appendChild(head);

    const guide = document.createElement('div');
    guide.className = 'photo-upload-guide';
    guide.textContent = 'Até 10 fotografias: frente, traseira, laterais, interior, quadrante com os quilómetros e eventuais danos. Não envie documentos.';
    card.appendChild(guide);
    renderPreviews(card);

    if (photoState.status === 'uploading' || photoState.message) {
      const status = document.createElement('div');
      status.className = `photo-upload-status ${photoState.status === 'complete' ? 'success' : photoState.status === 'error' ? 'error' : ''}`;
      status.textContent = photoState.message || 'A enviar fotografias…';
      card.appendChild(status);
    }
    if (photoState.status === 'uploading') {
      const progress = document.createElement('div');
      progress.className = 'photo-progress';
      progress.setAttribute('aria-hidden', 'true');
      progress.innerHTML = '<span></span>';
      card.appendChild(progress);
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif';
    input.multiple = true;
    input.hidden = true;
    input.setAttribute('aria-label', 'Escolher fotografias da viatura');
    input.addEventListener('change', () => {
      const files = [...(input.files || [])];
      input.value = '';
      handleFiles(files);
    });
    card.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'photo-upload-actions';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'photo-upload-primary';
    choose.disabled = photoState.status === 'uploading' || photoState.count >= MAX_PHOTOS;
    choose.textContent = photoState.status === 'uploading'
      ? 'A enviar…'
      : photoState.count
        ? (photoState.count >= MAX_PHOTOS ? '10 fotografias recebidas' : 'Adicionar fotografias')
        : 'Escolher fotografias';
    choose.addEventListener('click', () => input.click());
    actions.appendChild(choose);

    if (photoState.count && photoState.galleryUrl) {
      const gallery = document.createElement('a');
      gallery.className = 'photo-gallery-link';
      gallery.href = photoState.galleryUrl;
      gallery.target = '_blank';
      gallery.rel = 'noopener';
      gallery.textContent = 'Ver fotografias';
      actions.appendChild(gallery);
    } else if (photoState.status !== 'uploading') {
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'photo-upload-secondary';
      skip.textContent = 'Agora não';
      skip.addEventListener('click', () => {
        photoState.dismissed = true;
        photoState.fingerprint = currentFingerprint();
        saveDraft();
        card.remove();
      });
      actions.appendChild(skip);
    }

    card.appendChild(actions);
    const messages = document.getElementById('messages');
    const followupActions = document.getElementById('followupActions');
    if (messages && followupActions?.parentNode === messages) {
      messages.insertBefore(card, followupActions);
    } else {
      messages?.appendChild(card);
    }
    if (typeof scrollEnd === 'function') scrollEnd();
  }

  function schedulePhotoCard() {
    setTimeout(() => {
      if (!photoState.fingerprint && state?.lead?.retoma) photoState.fingerprint = currentFingerprint();
      renderPhotoCard();
    }, 0);
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyles();

    const previousWhatsappText = whatsappText;
    whatsappText = function whatsappTextWithPhotos() {
      const text = previousWhatsappText();
      if (!photoState.count || !photoState.galleryUrl) return text;
      return `${text}\nFotografias da retoma (${photoState.count}): ${photoState.galleryUrl}`;
    };

    const previousRenderSummary = renderSummary;
    renderSummary = function renderSummaryWithPhotos() {
      previousRenderSummary();
      const summary = document.getElementById('summary');
      summary?.querySelector('.photo-summary-row')?.remove();
      if (summary && photoState.count) {
        const row = document.createElement('div');
        row.className = 'summary-row photo-summary-row';
        row.innerHTML = `<b>Fotografias</b><span>${photoState.count} recebidas</span>`;
        summary.appendChild(row);
      }
      document.querySelectorAll('.followup-main').forEach((link) => { link.href = whatsappUrl(); });
      schedulePhotoCard();
    };

    const previousSelectVehicle = selectVehicle;
    selectVehicle = function selectVehicleWithFreshPhotos(item) {
      clearPhotoState();
      const result = previousSelectVehicle(item);
      schedulePhotoCard();
      return result;
    };

    const previousResetState = resetState;
    resetState = function resetStateWithFreshPhotos() {
      clearPhotoState();
      return previousResetState();
    };

    restoreDraft();
    if (photoState.batchId) {
      refreshGallery()
        .catch(() => null)
        .finally(() => {
          renderSummary();
          renderPhotoCard();
        });
    } else {
      renderSummary();
      schedulePhotoCard();
    }
  });
})();
