document.addEventListener('DOMContentLoaded', () => {
  const originalSendMessage = sendMessage;
  const originalBeginSelectedIntents = beginSelectedIntents;
  const originalSelectVehicle = selectVehicle;
  const completedIntents = new Set();

  function appendObservation(text) {
    const clean = String(text || '').trim();
    if (!clean || /^(ok|okay|obrigad[oa]|certo|perfeito)[.!?]*$/i.test(clean)) return;
    const request = `Pedido de informação: ${clean}`;
    const current = String(state.lead.observacoes || '');
    if (current.toLocaleLowerCase('pt-PT').includes(clean.toLocaleLowerCase('pt-PT'))) return;
    state.lead.observacoes = [current, request].filter(Boolean).join(' | ').slice(0, 500);
    renderSummary();
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

  function completeTradeIn(text) {
    const clean = String(text || '').trim();
    const year = clean.match(/\b(19|20)\d{2}\b/)?.[0] || '';
    const withoutYear = year ? clean.replace(year, ' ') : clean;
    const hasMileageUnit = /\b(km|kms|quil[oó]metros?)\b/i.test(clean);
    const numericValues = [...withoutYear.matchAll(/\b\d[\d .]{2,}\b/g)]
      .map((match) => Number(match[0].replace(/\D/g, '')))
      .filter((value) => Number.isFinite(value));
    const hasMileage = hasMileageUnit || numericValues.some((value) => value >= 1000);
    const words = clean.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]*/gu) || [];
    return Boolean(year && hasMileage && words.length >= 2);
  }

  beginSelectedIntents = function stableBeginSelectedIntents() {
    const newlySelected = [...state.selectedIntents];
    const previousObservations = String(state.lead.observacoes || '');
    for (const intent of newlySelected) completedIntents.add(intent);

    originalBeginSelectedIntents();

    const availabilityNote = newlySelected.includes('disponibilidade')
      ? 'Pedido de confirmação de disponibilidade.'
      : '';
    state.lead.observacoes = [previousObservations, availabilityNote]
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index)
      .join(' | ')
      .slice(0, 500);
    restoreCompletedIntents(newlySelected);
    renderSummary();
  };

  selectVehicle = function stableSelectVehicle(item) {
    completedIntents.clear();
    originalSelectVehicle(item);
  };

  sendMessage = async function stableSendMessage(message) {
    const text = String(message || '').trim();
    if (!text || state.busy) return;

    const currentIntent = state.pendingIntent;
    if (currentIntent === 'retoma' && !completeTradeIn(text)) {
      document.getElementById('messageInput').value = '';
      addBubble(text, 'user');
      addBubble('Faltam dados da retoma. Indique marca, modelo, ano e quilómetros, por exemplo: Renault Clio, 2019, 85 000 km.', 'bot');
      state.pendingIntent = 'retoma';
      document.getElementById('chatTitle').textContent = INTENTS.retoma.short;
      setComposer(INTENTS.retoma.placeholder);
      return;
    }

    const wasFreeQuestion = !currentIntent && !state.finished;
    const preparedBefore = hasPreparedLead();
    const selectedBefore = [...completedIntents];

    await originalSendMessage(text);

    if (currentIntent) {
      if (currentIntent !== 'contacto' && intentComplete(currentIntent)) completedIntents.add(currentIntent);
      restoreCompletedIntents();
      renderSummary();
      return;
    }

    if (!wasFreeQuestion) {
      restoreCompletedIntents();
      renderSummary();
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
  };

  document.getElementById('startBtn')?.click();
});
