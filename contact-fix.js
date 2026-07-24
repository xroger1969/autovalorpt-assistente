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
});