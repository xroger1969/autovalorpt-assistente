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

  const composer = document.getElementById('composer');
  const inputRow = composer?.querySelector('.input-row');
  const quickSend = document.createElement('a');
  quickSend.id = 'quickSendPartial';
  quickSend.target = '_blank';
  quickSend.rel = 'noopener';
  quickSend.hidden = true;
  quickSend.innerHTML = '<strong>Enviar o que já foi reunido ao Carlos</strong><span>Pode enviar agora e continuar a conversa depois.</span>';
  quickSend.style.cssText = 'display:none;margin:0 0 10px;padding:11px 13px;border:2px solid #9bd8bd;border-radius:14px;background:#f0fbf5;color:#087348;text-decoration:none;line-height:1.25;box-shadow:0 4px 14px rgba(21,144,95,.08)';
  quickSend.querySelector('strong').style.cssText = 'display:block;font-size:13px;font-weight:950';
  quickSend.querySelector('span').style.cssText = 'display:block;margin-top:3px;font-size:11px;color:#39735c';
  if (composer && inputRow) composer.insertBefore(quickSend, inputRow);

  function syncQuickSend() {
    if (!quickSend) return;
    const available = Boolean(state.vehicle || state.lead.viatura);
    quickSend.hidden = !available;
    quickSend.style.display = available ? 'block' : 'none';
    if (available) quickSend.href = whatsappUrl();
  }

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

  const previousResetState = resetState;
  resetState = function resetStateWithPartialSend() {
    previousResetState();
    syncQuickSend();
  };

  syncQuickSend();

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