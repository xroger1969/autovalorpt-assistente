document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'autovalorpt-assistente-draft-v2';
  const originalSendMessage = sendMessage;
  const originalBeginSelectedIntents = beginSelectedIntents;
  const originalSelectVehicle = selectVehicle;
  const originalFinishFlow = finishFlow;
  const completedIntents = new Set();

  function normalizeText(value = '') {
    const normalize = globalThis.AutoValorValidation?.normalizeText;
    return normalize
      ? normalize(value)
      : String(value).toLocaleLowerCase('pt-PT').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }

  function appendUnique(base, value, max = 500) {
    const current = String(base || '').trim();
    const next = String(value || '').trim();
    if (!next) return current;
    if (normalizeText(current).includes(normalizeText(next))) return current;
    return [current, next].filter(Boolean).join(' | ').slice(0, max);
  }

  function isSimpleAcknowledgement(text) {
    return /^(ok|okay|obrigad[oa]|certo|perfeito|sim|entendido)[.!?]*$/i.test(String(text || '').trim());
  }

  function appendObservation(text) {
    const clean = String(text || '').trim();
    if (!clean || isSimpleAcknowledgement(clean)) return;
    state.lead.observacoes = appendUnique(state.lead.observacoes, `Pedido de informação: ${clean}`);
    renderSummary();
    saveDraft();
  }

  function restoreCompletedIntents(extra = []) {
    for (const intent of extra) completedIntents.add(intent);
    state.selectedIntents = [...completedIntents];
  }

  function hasPreparedLead() {
    return Boolean(
      state.lead.nome &&
      state.lead.telefone &&
      (completedIntents.size || state.lead.financiamento || state.lead.retoma || state.lead.visita || state.lead.observacoes)
    );
  }

  function saveValidatedIntent(intent, text, normalized = '') {
    const clean = String(normalized || text || '').trim().slice(0, 180);
    if (intent === 'retoma') state.lead.retoma = clean;
    if (intent === 'financiamento') state.lead.financiamento = clean;
    if (intent === 'visita') state.lead.visita = clean;
    renderSummary();
    saveDraft();
  }

  function saveDraft() {
    try {
      if (!state.vehicle) return sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        savedAt: Date.now(),
        vehicle: state.vehicle,
        lead: state.lead,
        selectedIntents: [...completedIntents],
        intentQueue: state.intentQueue,
        pendingIntent: state.pendingIntent,
        finished: state.finished
      }));
    } catch {}
  }

  function clearDraft() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function readDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
      if (!draft?.vehicle || !draft?.savedAt || Date.now() - draft.savedAt > 2 * 60 * 60 * 1000) return null;
      return draft;
    } catch {
      return null;
    }
  }

  function restoreDraft(draft) {
    state.stockRequest += 1;
    state.vehicle = draft.vehicle;
    state.lead = { ...EMPTY_LEAD, ...draft.lead, viatura: draft.vehicle.title || draft.lead?.viatura || '' };
    state.selectedIntents = Array.isArray(draft.selectedIntents) ? draft.selectedIntents : [];
    state.intentQueue = Array.isArray(draft.intentQueue) ? draft.intentQueue : [];
    state.pendingIntent = String(draft.pendingIntent || '');
    state.finished = Boolean(draft.finished);
    for (const intent of state.selectedIntents) completedIntents.add(intent);
    document.getElementById('messages').textContent = '';
    document.getElementById('changeBtn').hidden = false;
    renderSelected();
    renderSummary();
    addBubble(`Retomámos o pedido relativo a ${state.lead.viatura}.`, 'bot');

    if (state.finished) {
      finishFlow();
      return;
    }
    if (state.pendingIntent && INTENTS[state.pendingIntent]) {
      document.getElementById('chatTitle').textContent = INTENTS[state.pendingIntent].short;
      addBubble(INTENTS[state.pendingIntent].prompt, 'bot');
      setComposer(INTENTS[state.pendingIntent].placeholder);
      return;
    }
    renderPurposeActions();
  }

  beginSelectedIntents = function stableBeginSelectedIntents() {
    const newlySelected = [...state.selectedIntents];
    const previousObservations = String(state.lead.observacoes || '');
    for (const intent of newlySelected) completedIntents.add(intent);
    originalBeginSelectedIntents();
    const availabilityNote = newlySelected.includes('disponibilidade') ? 'Pedido de confirmação de disponibilidade.' : '';
    state.lead.observacoes = appendUnique(previousObservations, availabilityNote);
    restoreCompletedIntents(newlySelected);
    renderSummary();
    saveDraft();
  };

  selectVehicle = function stableSelectVehicle(item) {
    completedIntents.clear();
    clearDraft();
    originalSelectVehicle(item);
    saveDraft();
  };

  finishFlow = function stableFinishFlow() {
    originalFinishFlow();
    restoreCompletedIntents();
    saveDraft();
  };

  sendMessage = async function stableSendMessage(message) {
    const text = String(message || '').trim();
    if (!text || state.busy) return;

    const currentIntent = state.pendingIntent;
    const wasFinished = state.finished;
    let validation = null;
    let originalRetry = '';

    if (wasFinished && isSimpleAcknowledgement(text)) {
      document.getElementById('messageInput').value = '';
      addBubble(text, 'user');
      addBubble('✓ O pedido continua preparado para enviar ao Carlos.', 'bot', true, 'confirmed');
      renderFollowupActions();
      saveDraft();
      return;
    }

    if (currentIntent && currentIntent !== 'contacto') {
      const validator = globalThis.AutoValorValidation?.validateIntent;
      validation = validator
        ? validator(currentIntent, text)
        : { ok: false, hardReject: false, retry: INTENTS[currentIntent]?.retry || 'Falta completar esta informação.' };

      if (!validation.ok && validation.hardReject) {
        document.getElementById('messageInput').value = '';
        addBubble(text, 'user');
        addBubble(validation.retry, 'bot');
        state.pendingIntent = currentIntent;
        document.getElementById('chatTitle').textContent = INTENTS[currentIntent].short;
        setComposer(INTENTS[currentIntent].placeholder);
        saveDraft();
        return;
      }

      if (validation.ok) saveValidatedIntent(currentIntent, text, validation.normalized);

      if (!validation.ok && validation.retry && INTENTS[currentIntent]) {
        originalRetry = INTENTS[currentIntent].retry;
        INTENTS[currentIntent].retry = validation.retry;
      }
    }

    const wasFreeQuestion = !currentIntent && !wasFinished;
    const preparedBefore = hasPreparedLead();
    const selectedBefore = [...completedIntents];

    if (wasFinished) state.finished = false;
    try {
      await originalSendMessage(text);
    } finally {
      if (currentIntent && originalRetry && INTENTS[currentIntent]) INTENTS[currentIntent].retry = originalRetry;
    }

    if (wasFinished) {
      appendObservation(text);
      restoreCompletedIntents(selectedBefore);
      state.intentQueue = [];
      state.pendingIntent = '';
      finishFlow();
      return;
    }

    if (currentIntent) {
      if (currentIntent !== 'contacto' && intentComplete(currentIntent)) {
        completedIntents.add(currentIntent);
        restoreCompletedIntents();
        if (state.pendingIntent === currentIntent) {
          state.pendingIntent = '';
          addConfirmation(currentIntent);
          advanceIntent();
        }
      } else if (currentIntent !== 'contacto') {
        state.pendingIntent = currentIntent;
        document.getElementById('chatTitle').textContent = INTENTS[currentIntent].short;
        setComposer(INTENTS[currentIntent].placeholder);
      }
      renderSummary();
      saveDraft();
      return;
    }

    if (!wasFreeQuestion) {
      restoreCompletedIntents();
      renderSummary();
      saveDraft();
      return;
    }

    appendObservation(text);
    if (preparedBefore || (state.lead.nome && state.lead.telefone)) {
      restoreCompletedIntents(selectedBefore);
      state.intentQueue = [];
      state.pendingIntent = '';
      finishFlow();
      return;
    }

    restoreCompletedIntents(selectedBefore);
    removeActionPanels();
    state.pendingIntent = 'contacto';
    document.getElementById('chatTitle').textContent = 'Contacto';
    addBubble('Para enviar este pedido ao Carlos, indique o seu nome e número de telemóvel ou WhatsApp.', 'bot');
    setComposer(INTENTS.contacto.placeholder);
    saveDraft();
  };

  window.addEventListener('pagehide', saveDraft);
  document.getElementById('resetBtn')?.addEventListener('click', clearDraft, { capture: true });
  document.getElementById('changeBtn')?.addEventListener('click', clearDraft, { capture: true });

  const draft = readDraft();
  document.getElementById('startBtn')?.click();
  if (draft) setTimeout(() => restoreDraft(draft), 0);
});