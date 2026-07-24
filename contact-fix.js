document.addEventListener('DOMContentLoaded', () => {
  handleContact = function stableHandleContact(text) {
    const clean = String(text || '').trim();
    document.getElementById('messageInput').value = '';
    addBubble(clean, 'user');

    const parser = globalThis.AutoValorValidation?.extractFlexibleContact;
    const { nome = '', telefone = '', candidateDigits = '' } = parser
      ? parser(clean)
      : { nome: '', telefone: '', candidateDigits: '' };

    if (!telefone) {
      let message = 'Indique um número de telemóvel português válido com 9 algarismos, por exemplo: 923 445 556.';
      if (candidateDigits && candidateDigits.length !== 9) {
        message = `O número indicado tem ${candidateDigits.length} algarismos. Um telemóvel português deve ter 9, por exemplo: 923 445 556.`;
      } else if (candidateDigits.length === 9 && !candidateDigits.startsWith('9')) {
        message = 'O número de telemóvel deve começar por 9 e ter 9 algarismos.';
      }
      addBubble(message, 'bot');
      state.pendingIntent = 'contacto';
      setComposer(INTENTS.contacto.placeholder);
      return;
    }

    if (!nome) {
      addBubble('O número está correto, mas não consegui identificar o nome. Escreva, por exemplo: Carlos 923 445 556.', 'bot');
      state.pendingIntent = 'contacto';
      setComposer(INTENTS.contacto.placeholder);
      return;
    }

    state.lead.nome = nome;
    state.lead.telefone = telefone;
    state.pendingIntent = '';
    renderSummary();
    renderSelected();
    addConfirmation('contacto');
    advanceIntent();
  };

  const style = document.createElement('style');
  style.textContent = `
    .free-question-box{margin:0;padding:12px;border:2px solid #9fc5f4;border-radius:18px;background:#f5f9ff;box-shadow:0 5px 18px rgba(11,94,215,.08)}
    .free-question-title{display:flex;align-items:center;gap:7px;color:#124b92;font-size:13px;font-weight:950;line-height:1.3}
    .free-question-hint{margin:4px 0 10px;color:#526783;font-size:11px;line-height:1.35}
    .free-question-box .input-row input{border:2px solid #c5d9f2;background:#fff}
    .free-question-box .input-row input:focus{outline:3px solid rgba(11,94,215,.12);border-color:#0b5ed7}
    #quickSendPartial{margin:12px 0 0;padding:11px 13px;border:2px solid #9bd8bd;border-radius:14px;background:#f0fbf5;color:#087348;text-decoration:none;line-height:1.25;box-shadow:0 4px 14px rgba(21,144,95,.08)}
    #quickSendPartial strong{display:block;font-size:13px;font-weight:950}
    #quickSendPartial span{display:block;margin-top:3px;font-size:11px;color:#39735c}
    @media(max-width:820px){.free-question-box{padding:11px}.free-question-title{font-size:12.5px}.free-question-hint{font-size:10.5px}}
  `;
  document.head.appendChild(style);

  const composer = document.getElementById('composer');
  const inputRow = composer?.querySelector('.input-row');
  const privacy = composer?.querySelector('.privacy');
  const messageInput = document.getElementById('messageInput');

  const freeQuestionBox = document.createElement('section');
  freeQuestionBox.id = 'freeQuestionBox';
  freeQuestionBox.className = 'free-question-box';
  const freeQuestionTitle = document.createElement('div');
  freeQuestionTitle.className = 'free-question-title';
  const freeQuestionHint = document.createElement('div');
  freeQuestionHint.className = 'free-question-hint';
  freeQuestionBox.append(freeQuestionTitle, freeQuestionHint);
  if (composer && inputRow) {
    composer.insertBefore(freeQuestionBox, privacy || inputRow);
    freeQuestionBox.appendChild(inputRow);
  }

  const quickSend = document.createElement('a');
  quickSend.id = 'quickSendPartial';
  quickSend.target = '_blank';
  quickSend.rel = 'noopener';
  quickSend.hidden = true;
  quickSend.innerHTML = '<strong>Enviar o que já foi reunido ao Carlos</strong><span>Pode enviar agora e continuar a conversa depois.</span>';
  if (composer) composer.appendChild(quickSend);

  let messageInteraction = false;

  function updateFreeQuestionPrompt() {
    if (!freeQuestionTitle || !freeQuestionHint) return;
    if (!state.vehicle) {
      freeQuestionTitle.textContent = '💬 Escreva diretamente a sua dúvida';
      freeQuestionHint.textContent = 'Depois de escolher uma viatura, pode conversar livremente com o assistente.';
      return;
    }
    if (state.finished) {
      freeQuestionTitle.textContent = '💬 Ainda tem alguma dúvida?';
      freeQuestionHint.textContent = 'Pode continuar a perguntar sem voltar a preencher o pedido.';
      return;
    }
    if (state.pendingIntent) {
      freeQuestionTitle.textContent = '💬 Responda aqui ou escreva outra necessidade';
      freeQuestionHint.textContent = 'Não precisa de completar tudo agora. Pode enviar ao Carlos quando entender.';
      return;
    }
    freeQuestionTitle.textContent = '💬 Prefere escrever diretamente?';
    freeQuestionHint.textContent = 'Ex.: “Tem garantia?”, “Aceitam retoma?” ou “Quanto poderá ficar por mês?”';
  }

  function hasCollectedInformation() {
    const lead = state.lead || {};
    return Boolean(
      messageInteraction
      || messageInput?.value.trim()
      || state.selectedIntents?.length
      || state.pendingIntent
      || state.finished
      || lead.nome
      || lead.telefone
      || lead.financiamento
      || lead.retoma
      || lead.visita
      || lead.observacoes
    );
  }

  function quickSendUrl() {
    const draft = String(messageInput?.value || '').trim();
    if (!draft) return whatsappUrl();
    return `https://wa.me/${PHONE}?text=${encodeURIComponent(`${whatsappText()}\nMensagem: ${draft}`)}`;
  }

  function syncQuickSend() {
    const hasVehicle = Boolean(state.vehicle || state.lead?.viatura);
    const available = hasVehicle && hasCollectedInformation();
    quickSend.hidden = !available;
    quickSend.style.display = available ? 'block' : 'none';
    if (available) quickSend.href = quickSendUrl();

    const sideSend = document.getElementById('sideWhatsApp');
    if (sideSend) {
      sideSend.hidden = !available;
      sideSend.style.display = available ? 'grid' : 'none';
      if (available) sideSend.href = quickSendUrl();
    }
    updateFreeQuestionPrompt();
  }

  const previousSetComposer = setComposer;
  setComposer = function setComposerWithFreePrompt(placeholder, hidden = false) {
    previousSetComposer(placeholder, hidden);
    updateFreeQuestionPrompt();
  };

  const previousRenderPurposeActions = renderPurposeActions;
  renderPurposeActions = function renderPurposeActionsWithFreeWriting() {
    previousRenderPurposeActions();
    const wrap = document.getElementById('purposeActions');
    wrap?.querySelectorAll('.quick').forEach((button) => {
      button.addEventListener('click', syncQuickSend);
    });
    const heading = wrap?.querySelector('.action-heading');
    if (heading) heading.textContent = 'Opções rápidas — escolha uma ou várias';
    const input = document.getElementById('messageInput');
    if (input && !state.pendingIntent) input.placeholder = 'Escreva aqui a sua dúvida ou necessidade…';
    syncQuickSend();
  };

  const previousRenderSummary = renderSummary;
  renderSummary = function renderSummaryWithPartialSend() {
    previousRenderSummary();
    syncQuickSend();
  };

  const previousRenderSelected = renderSelected;
  renderSelected = function renderSelectedWithPartialSend() {
    previousRenderSelected();
    syncQuickSend();
  };

  const previousSelectVehicle = selectVehicle;
  selectVehicle = function selectVehicleWithoutPrematureSend(item) {
    messageInteraction = false;
    previousSelectVehicle(item);
    syncQuickSend();
  };

  const previousResetState = resetState;
  resetState = function resetStateWithPartialSend() {
    messageInteraction = false;
    previousResetState();
    syncQuickSend();
  };

  syncQuickSend();
  messageInput?.addEventListener('input', syncQuickSend);

  const previousSendMessage = sendMessage;

  function questionKey(value = '') {
    return String(value)
      .toLocaleLowerCase('pt-PT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function observationAlreadyExists(question = '') {
    const key = questionKey(question);
    if (!key) return true;
    return questionKey(state.lead.observacoes).includes(key);
  }

  function addPreparedObservation(question = '') {
    const clean = String(question || '').trim();
    if (!clean || observationAlreadyExists(clean)) return;
    const note = `Pedido de informação: ${clean}`;
    state.lead.observacoes = [state.lead.observacoes, note]
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500);
    renderSummary();
  }

  function removeRepeatedClosing(reply = '') {
    const sentences = String(reply || '')
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[^.!?]+[.!?]?/g) || [];

    const filtered = sentences.filter((sentence) => {
      const value = questionKey(sentence);
      return !(
        /pergunta .* registad|questao .* registad|fica registad .* pedido/.test(value)
        || /pedido .* continua .* preparad|pedido .* mantem .* preparad/.test(value)
        || /vou passar .* carlos|passar .* ao carlos/.test(value)
        || /pode indicar .* contacto|qual .* contacto|para ele .* contactar/.test(value)
        || /enviar .* pedido .* carlos/.test(value)
      );
    });

    return filtered.join(' ').trim() || 'A informação concreta deverá ser confirmada pelo Carlos.';
  }

  sendMessage = async function conversationalPreparedSend(message) {
    const text = String(message || '').trim();
    if (!text || state.busy) return;

    messageInteraction = true;
    syncQuickSend();

    if (!state.finished) return previousSendMessage(text);

    if (/^(ok|okay|obrigad[oa]|certo|perfeito|sim|entendido)[.!?]*$/i.test(text)) {
      document.getElementById('messageInput').value = '';
      addBubble(text, 'user');
      renderFollowupActions();
      syncQuickSend();
      return;
    }

    document.getElementById('messageInput').value = '';
    removeActionPanels();
    addBubble(text, 'user');
    showTyping();
    setBusy(true);

    try {
      const data = await fetchJson('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          intent: '',
          contexto: { viatura: state.vehicle?.title || state.lead.viatura || '' },
          lead: state.lead,
          history: [
            {
              role: 'assistant',
              content: 'O pedido comercial já está completo e preparado. Responde apenas à nova pergunta do cliente. Não repitas o resumo, não voltes a dizer que o pedido foi registado ou preparado, não peças novamente nome ou contacto e não anuncies que vais passar o pedido ao Carlos.'
            },
            ...state.history.slice(-6)
          ]
        })
      });

      const reply = removeRepeatedClosing(data.reply || 'A informação concreta deverá ser confirmada pelo Carlos.');
      addBubble(reply, 'bot');
      addPreparedObservation(text);
      state.finished = true;
      state.pendingIntent = '';
      document.getElementById('chatTitle').textContent = 'Pedido preparado';
      setComposer('Pode fazer outra pergunta…');
      renderFollowupActions();
      syncQuickSend();
    } catch (error) {
      const timedOut = error?.name === 'AbortError';
      addBubble(
        timedOut
          ? 'A resposta está a demorar mais do que o normal. Tente novamente.'
          : 'Não consegui confirmar essa informação automaticamente. O Carlos poderá esclarecê-la consigo.',
        'bot'
      );
      state.finished = true;
      renderFollowupActions();
      syncQuickSend();
    } finally {
      hideTyping();
      setBusy(false);
      fitMobileViewport();
    }
  };
});
