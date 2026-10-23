// A request is sent only after the customer reviews the fields and presses Enviar pedido.
document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'autovalorpt-assistente-submission-v3';
  let sending = false;
  let submission = readSubmission();
  const composer = document.getElementById('composer');
  const style = document.createElement('style');
  style.textContent = `
    #quickSendPartial,#sideWhatsApp{display:none!important}
    #followupActions{display:block}
    .request-review{padding:18px;border:2px solid #a3c7f5;border-radius:20px;background:#f5f9ff;color:#122033}
    .request-review h2{margin:0 0 8px;font-size:23px;line-height:1.25}
    .review-intro{margin:0 0 18px;color:#4c607b;line-height:1.5;font-size:16px}
    .review-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:0;padding:0;border:0;min-width:0}
    .review-field{display:grid;gap:6px;font-size:15px;font-weight:800;min-width:0}
    .review-field.wide{grid-column:1/-1}
    .review-field input,.review-field textarea{width:100%;min-height:50px;padding:11px 12px;border:1px solid #aebfd5;border-radius:11px;background:#fff;color:#122033;font:inherit;font-size:17px;font-weight:500}
    .review-field textarea{resize:vertical;min-height:84px;line-height:1.4}
    .review-fields:disabled input,.review-fields:disabled textarea{opacity:1;color:#334860;background:#edf3fa;-webkit-text-fill-color:#334860}
    .review-photos,.review-contact-note{font-size:15px;line-height:1.5;color:#4c607b}
    .review-submit{width:100%;min-height:60px;padding:14px;border:0;border-radius:15px;background:#0b5ed7;color:#fff;font-size:20px;font-weight:900;cursor:pointer}
    .review-submit:disabled{opacity:.55;cursor:wait}
    .review-status{margin:12px 0 0;font-size:16px;font-weight:700;line-height:1.5;white-space:pre-line}
    .review-status.error{color:#9a301b}
    .review-status.success{color:#075f3d}
    .review-new,.review-more{width:100%;min-height:48px;margin-top:10px;border:1px solid #9fbbdf;border-radius:13px;background:#fff;color:#164b91;font-size:16px;font-weight:800}
    .review-receipt{padding:12px;border:1px solid #a7d6bb;border-radius:12px;background:#effaf5;font-size:16px;line-height:1.5}
    @media(max-width:820px){.review-fields{grid-template-columns:1fr}.request-review{padding:16px}.review-submit{min-height:62px}.review-field input,.review-field textarea{font-size:18px}}
  `;
  document.head.appendChild(style);

  function readSubmission() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!value?.requestId || !value?.payload || Date.now() - Number(value.createdAt || 0) > 2 * 60 * 60 * 1000) return null;
      if (value.status === 'sending') value.status = 'retry';
      return value;
    } catch { return null; }
  }

  function saveSubmission() {
    try {
      if (submission) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(submission));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function reset() {
    submission = null;
    sending = false;
    saveSubmission();
    document.getElementById('followupActions')?.remove();
  }

  function currentLead() {
    const lead = state.lead || {};
    const subjects = [...new Set((state.selectedIntents || [])
      .filter((intent) => intent !== 'retoma' || String(lead.retoma || '').trim())
      .map((intent) => ACTIONS.find((action) => action[0] === intent)?.[2] || INTENTS[intent]?.short || intent))];
    if (String(lead.observacoes || '').trim() && !subjects.length) subjects.push('Pedido de informação');
    return {
      name: String(lead.nome || '').trim(),
      phone: globalThis.AutoValorValidation.normalizePhone(lead.telefone),
      vehicle: String(lead.viatura || '').trim(),
      vehicleUrl: state.vehicle?.title === lead.viatura ? String(state.vehicle?.url || '') : '',
      subjects: subjects.join(', '),
      visit: String(lead.visita || '').trim(),
      financing: String(lead.financiamento || '').trim(),
      tradeIn: String(lead.retoma || '').trim(),
      registration: String(lead.matricula || '').trim().toLocaleUpperCase('pt-PT'),
      observations: String(lead.observacoes || '').trim()
    };
  }

  function validationError() {
    const lead = state.lead || {};
    const validator = globalThis.AutoValorValidation;
    if (!validator.validContactName(lead.nome) || String(lead.nome || '').trim().length < 2) return ['nome', 'Indique o seu nome para o Carlos saber com quem falar.'];
    if (!validator.normalizePhone(lead.telefone)) return ['telefone', 'Indique o número completo: 9 algarismos, opcionalmente com +351.'];
    if (![lead.financiamento, lead.retoma, lead.visita, lead.observacoes].some((value) => String(value || '').trim())) return ['observacoes', 'Escreva a pergunta ou o pedido que pretende enviar ao Carlos.'];
    if (lead.retoma) {
      const result = validator.validateTradeIn(lead.retoma);
      if (!result.ok) return ['retoma', result.retry];
      if (!/^(?:[A-Z]{2}-\d{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-\d{2}-[A-Z]{2})$/.test(String(lead.matricula || '').toUpperCase())) return ['matricula', 'Confirme a matrícula da retoma, por exemplo: AA-00-AA.'];
    }
    if (lead.financiamento) {
      const result = validator.validateFinancing(lead.financiamento);
      if (!result.ok) return ['financiamento', result.retry];
    }
    if (lead.visita) {
      const result = validator.validateVisit(lead.visita);
      if (!result.ok) return ['visita', result.retry];
    }
    return null;
  }

  function showStatus(message, kind = '') {
    const status = document.getElementById('reviewStatus');
    if (!status) return;
    status.className = `review-status ${kind}`;
    status.textContent = message;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function syncReviewStatus() {
    const button = document.getElementById('submitLead');
    const fields = document.getElementById('reviewFields');
    const photos = window.AutoValorPhotos;
    const photoReady = photos?.readyForSubmit?.() !== false;
    if (fields) fields.disabled = Boolean(submission?.payload);
    if (button) {
      button.hidden = submission?.status === 'received';
      button.disabled = sending || (!submission && !photoReady);
      button.textContent = sending ? 'A enviar o pedido…' : submission?.status === 'retry' ? 'Tentar novamente' : !photoReady ? 'A carregar fotografias…' : 'Enviar pedido';
    }
    const count = submission?.payload?.photoSession?.count ?? photos?.getLeadAttachment?.()?.count ?? 0;
    const photoStatus = document.getElementById('reviewPhotoStatus');
    if (photoStatus) photoStatus.textContent = !photoReady && !submission ? 'Aguarde pela conclusão do carregamento das fotografias.' : count ? `${count} ${count === 1 ? 'fotografia da retoma' : 'fotografias da retoma'} ${submission?.status === 'received' ? (count === 1 ? 'incluída' : 'incluídas') : (count === 1 ? 'será incluída' : 'serão incluídas')} no pedido.` : 'Sem fotografias anexadas.';
    if (composer && submission) composer.hidden = true;
  }

  function renderReview() {
    document.getElementById('followupActions')?.remove();
    if (!state.finished) return;
    const form = el('form', 'request-review');
    form.id = 'followupActions';
    form.noValidate = true;
    form.setAttribute('aria-label', 'Rever e enviar pedido');
    form.appendChild(el('h2', '', submission?.status === 'received' ? 'Pedido recebido' : 'Reveja o seu pedido'));
    form.appendChild(el('p', 'review-intro', submission?.status === 'received'
      ? 'O pedido foi guardado para o Carlos lhe dar seguimento.'
      : 'Confirme ou corrija os dados abaixo antes de enviar.'));
    const fields = el('fieldset', 'review-fields');
    fields.id = 'reviewFields';
    const definitions = [
      ['nome', 'Nome', 'text', 'name', 80],
      ['telefone', 'Telemóvel / WhatsApp', 'tel', 'tel', 24],
      ['viatura', 'Viatura (se já escolheu)', 'text', 'off', 220],
      ...(state.lead.financiamento ? [['financiamento', 'Financiamento pretendido', 'textarea', 'off', 500]] : []),
      ...(state.lead.retoma ? [['retoma', 'Retoma: marca, modelo, ano e quilómetros', 'textarea', 'off', 500], ['matricula', 'Matrícula da retoma', 'text', 'off', 12]] : []),
      ...(state.lead.visita ? [['visita', 'Visita pretendida (sujeita a confirmação)', 'text', 'off', 220]] : []),
      ['observacoes', 'Pergunta / observações', 'textarea', 'off', 1000]
    ];
    for (const [key, label, type, autocomplete, max] of definitions) {
      const wrap = el('label', `review-field${['nome', 'telefone'].includes(key) ? '' : ' wide'}`);
      wrap.htmlFor = `review-${key}`;
      wrap.appendChild(el('span', '', label));
      const input = el(type === 'textarea' ? 'textarea' : 'input');
      input.id = `review-${key}`;
      input.name = key;
      if (type !== 'textarea') input.type = type;
      input.autocomplete = autocomplete;
      input.maxLength = max;
      if (type === 'tel') input.inputMode = 'tel';
      input.value = String(state.lead[key] || '');
      input.addEventListener('input', () => {
        if (submission) return;
        state.lead[key] = input.value;
        renderSummary();
        window.AutoValorDraft?.save?.();
        showStatus('');
      });
      wrap.appendChild(input);
      fields.appendChild(wrap);
    }
    form.appendChild(fields);
    const photos = el('p', 'review-photos');
    photos.id = 'reviewPhotoStatus';
    form.appendChild(photos);
    if (submission?.status !== 'received') form.appendChild(el('p', 'review-contact-note', 'Ao enviar, pede ao Carlos que o contacte sobre este pedido.'));
    const status = el('p', 'review-status');
    status.id = 'reviewStatus';
    status.setAttribute('aria-live', 'polite');
    form.appendChild(status);
    const submitButton = el('button', 'review-submit', 'Enviar pedido');
    submitButton.id = 'submitLead';
    submitButton.type = 'submit';
    form.appendChild(submitButton);
    if (!submission) {
      const more = el('button', 'review-more', 'Adicionar outro assunto');
      more.type = 'button';
      more.addEventListener('click', renderPurposeActions);
      form.appendChild(more);
    }
    if (submission?.status === 'received') {
      const reference = typeof submission.receipt === 'string' ? submission.receipt : submission.leadId;
      form.appendChild(el('p', 'review-receipt', `Referência: ${reference || 'Pedido confirmado'}. O Carlos entrará em contacto consigo.`));
      const next = el('button', 'review-new', 'Fazer novo pedido');
      next.type = 'button';
      next.addEventListener('click', changeVehicle);
      form.appendChild(next);
    }
    form.addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    document.getElementById('messages')?.appendChild(form);
    syncReviewStatus();
    if (submission?.status === 'retry') showStatus('Não conseguimos confirmar a receção. Tente novamente: será usado o mesmo pedido para evitar duplicados.', 'error');
    if (submission?.status === 'received') showStatus('✓ Pedido guardado com sucesso.', 'success');
    scrollEnd();
  }

  async function submit() {
    if (sending || submission?.status === 'received' || !state.finished) return;
    if (!submission) {
      const error = validationError();
      if (error) {
        showStatus(error[1], 'error');
        document.getElementById(`review-${error[0]}`)?.focus();
        return;
      }
      if (window.AutoValorPhotos?.readyForSubmit?.() === false || window.AutoValorPhotos?.freezeForSubmit?.() === false) {
        showStatus('Aguarde até terminar o carregamento das fotografias.', 'error');
        return;
      }
      const requestId = uuid();
      submission = {
        requestId, createdAt: Date.now(), status: 'sending',
        payload: { requestId, lead: currentLead(), photoSession: window.AutoValorPhotos?.getLeadAttachment?.() || null }
      };
      saveSubmission();
    }
    sending = true;
    submission.status = 'sending';
    saveSubmission();
    syncReviewStatus();
    showStatus('A guardar o pedido. Aguarde um momento.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/notify-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.payload), signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true || result.persisted !== true || !result.leadId) {
        if ([400, 413, 422].includes(response.status) && result.persisted !== true) {
          submission = null;
          saveSubmission();
          window.AutoValorPhotos?.resumeEditing?.();
          if (composer) composer.hidden = false;
          renderReview();
          showStatus('O pedido ainda não foi enviado. Confirme os dados do resumo e tente novamente.', 'error');
          return;
        }
        throw new Error('receipt_not_confirmed');
      }
      submission.status = 'received';
      submission.leadId = result.leadId;
      submission.receipt = result.receipt || result.leadId;
      if (submission.payload.photoSession) {
        submission.payload.photoSession = { batchId: submission.payload.photoSession.batchId, count: submission.payload.photoSession.count };
      }
      saveSubmission();
      window.AutoValorPhotos?.markSubmitted?.(result.leadId);
      window.AutoValorDraft?.save?.();
      document.getElementById('chatTitle').textContent = 'Pedido recebido';
      renderReview();
    } catch {
      if (submission) submission.status = 'retry';
      saveSubmission();
      showStatus('Não conseguimos confirmar a receção. Toque em “Tentar novamente”. Será usado o mesmo pedido para evitar duplicados.', 'error');
    } finally {
      clearTimeout(timer);
      sending = false;
      syncReviewStatus();
    }
  }

  window.AutoValorLead = { submit, renderReview, reset, isSubmitted: () => submission?.status === 'received', get requestId() { return submission?.requestId || ''; } };
  const originalRenderSummary = renderSummary;
  renderSummary = function renderSummaryWithReceipt() { originalRenderSummary(); syncReviewStatus(); };
  const originalSelectVehicle = selectVehicle;
  selectVehicle = function selectVehicleWithNewRequest(item) { reset(); return originalSelectVehicle(item); };
  const originalResetState = resetState;
  resetState = function resetStateWithNewRequest() { reset(); return originalResetState(); };
  document.addEventListener('autovalor:photos-changed', syncReviewStatus);
  window.addEventListener('pagehide', saveSubmission);
  if (state.finished) renderReview();
});
