document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY = 'autovalorpt-assistente-draft-v2';
  const originalSendMessage = sendMessage;
  const originalBeginSelectedIntents = beginSelectedIntents;
  const originalSelectVehicle = selectVehicle;
  const originalFinishFlow = finishFlow;
  const completedIntents = new Set();

  function normalizeText(value = '') {
    return String(value).toLocaleLowerCase('pt-PT').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }

  function appendUnique(base, value, max = 500) {
    const current = String(base || '').trim();
    const next = String(value || '').trim();
    if (!next) return current;
    if (normalizeText(current).includes(normalizeText(next))) return current;
    return [current, next].filter(Boolean).join(' | ').slice(0, max);
  }

  function appendObservation(text) {
    const clean = String(text || '').trim();
    if (!clean || /^(ok|okay|obrigad[oa]|certo|perfeito|sim)[.!?]*$/i.test(clean)) return;
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

  function validateTradeIn(text) {
    const clean = String(text || '').trim();
    const year = clean.match(/\b(19|20)\d{2}\b/)?.[0] || '';
    const withoutYear = year ? clean.replace(year, ' ') : clean;
    const hasMileageUnit = /\b(km|kms|quil[oó]metros?)\b/i.test(clean);
    const numericValues = [...withoutYear.matchAll(/\b\d[\d .]{2,}\b/g)]
      .map((match) => Number(match[0].replace(/\D/g, '')))
      .filter(Number.isFinite);
    const hasMileage = hasMileageUnit || numericValues.some((value) => value >= 1000);
    const words = clean.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*/gu) || [];
    return {
      ok: Boolean(year && hasMileage && words.length >= 2),
      retry: 'Faltam dados da retoma. Indique marca, modelo, ano e quilómetros, por exemplo: Renault Clio, 2019, 85 000 km.'
    };
  }

  function validateFinancing(text) {
    const clean = normalizeText(text);
    const euroValues = [...String(text).matchAll(/\b\d[\d .]*\s*€/g)].map((match) => match[0]);
    const hasEntry = /\bentrada\b/.test(clean) || /\bsem entrada\b/.test(clean) || euroValues.length >= 2;
    const hasTerm = /\b\d{1,3}\s*(mes|meses|ano|anos)\b/.test(clean) || /\bprazo\b/.test(clean);
    const hasMonthly = /\b(mensalidade|prestacao|renda)\b/.test(clean) || euroValues.length >= 2;
    return {
      ok: Boolean(hasEntry && (hasTerm || hasMonthly)),
      retry: 'Falta completar o financiamento. Indique a entrada e o prazo ou mensalidade, por exemplo: 3 000 € de entrada e 84 meses.'
    };
  }

  function validateVisit(text) {
    const clean = normalizeText(text);
    const hasDay = /\b(hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado)\b/.test(clean)
      || /\bdia\s+\d{1,2}\b/.test(clean)
      || /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(clean);
    const hasTime = /\b\d{1,2}(?:[:h]\d{0,2})\b/.test(clean)
      || /\b(meio[- ]dia|meia[- ]noite)\b/.test(clean);
    return {
      ok: Boolean(hasDay && hasTime),
      retry: 'Falta indicar o dia e o horário. Pode escrever, por exemplo: dia 28 às 17h.'
    };
  }

  function validateIntent(intent, text) {
    if (intent === 'retoma') return validateTradeIn(text);
    if (intent === 'financiamento') return validateFinancing(text);
    if (intent === 'visita') return validateVisit(text);
    return { ok: true, retry: '' };
  }

  function saveValidatedIntent(intent, text) {
    const clean = String(text || '').trim().slice(0, 180);
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
    } catch { return null; }
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
    if (state.finished) return finishFlow();
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
    if (currentIntent && currentIntent !== 'contacto') {
      const validation = validateIntent(currentIntent, text);
      if (!validation.ok) {
        document.getElementById('messageInput').value = '';
        addBubble(text, 'user');
        addBubble(validation.retry, 'bot');
        state.pendingIntent = currentIntent;
        document.getElementById('chatTitle').textContent = INTENTS[currentIntent].short;
        setComposer(INTENTS[currentIntent].placeholder);
        saveDraft();
        return;
      }
      saveValidatedIntent(currentIntent, text);
    }

    const wasFreeQuestion = !currentIntent && !state.finished;
    const preparedBefore = hasPreparedLead();
    const selectedBefore = [...completedIntents];

    await originalSendMessage(text);

    if (currentIntent) {
      if (currentIntent !== 'contacto') {
        completedIntents.add(currentIntent);
        restoreCompletedIntents();
        if (state.pendingIntent === currentIntent) {
          state.pendingIntent = '';
          addConfirmation(currentIntent);
          advanceIntent();
        }
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