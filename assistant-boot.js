document.addEventListener('DOMContentLoaded', () => {
  const originalSendMessage = sendMessage;

  function appendObservation(text) {
    const clean = String(text || '').trim();
    if (!clean || /^(ok|okay|obrigad[oa]|certo|perfeito)[.!?]*$/i.test(clean)) return;
    const request = `Pedido de informação: ${clean}`;
    const current = String(state.lead.observacoes || '');
    if (current.toLocaleLowerCase('pt-PT').includes(clean.toLocaleLowerCase('pt-PT'))) return;
    state.lead.observacoes = [current, request].filter(Boolean).join(' | ').slice(0, 500);
    renderSummary();
  }

  function hasPreparedLead() {
    return Boolean(
      state.lead.nome &&
      state.lead.telefone &&
      (state.selectedIntents.length || state.lead.financiamento || state.lead.retoma || state.lead.visita || state.lead.observacoes)
    );
  }

  sendMessage = async function stableSendMessage(message) {
    const text = String(message || '').trim();
    if (!text || state.busy) return;

    const wasFreeQuestion = !state.pendingIntent && !state.finished;
    const preparedBefore = hasPreparedLead();
    const selectedBefore = [...state.selectedIntents];

    await originalSendMessage(text);

    if (!wasFreeQuestion) return;

    appendObservation(text);

    if (preparedBefore || (state.lead.nome && state.lead.telefone)) {
      state.selectedIntents = selectedBefore;
      state.intentQueue = [];
      state.pendingIntent = '';
      finishFlow();
      return;
    }

    removeActionPanels();
    state.pendingIntent = 'contacto';
    document.getElementById('chatTitle').textContent = 'Contacto';
    addBubble('Para enviar este pedido ao Carlos, indique o seu nome e número de telemóvel ou WhatsApp.', 'bot');
    setComposer(INTENTS.contacto.placeholder);
  };

  document.getElementById('startBtn')?.click();
});
