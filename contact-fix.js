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
    } finally {
      hideTyping();
      setBusy(false);
      fitMobileViewport();
    }
  };
});