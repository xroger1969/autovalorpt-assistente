document.addEventListener('DOMContentLoaded', () => {
  let pendingFreeRequest = '';
  const originalSendMessage = window.sendMessage;

  function appendObservation(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    const request = `Pedido de informação: ${clean}`;
    const current = String(window.state?.lead?.observacoes || '');
    if (current.includes(clean)) return;
    window.state.lead.observacoes = [current, request].filter(Boolean).join(' | ').slice(0, 350);
    window.renderSummary?.();
  }

  function requestContactForFreeQuestion() {
    window.removeActionPanels?.();
    window.state.pendingIntent = 'contacto';
    const title = document.getElementById('chatTitle');
    if (title) title.textContent = 'Contacto';

    const messages = document.getElementById('messages');
    const lastBot = [...(messages?.querySelectorAll('.bubble.bot') || [])].at(-1)?.textContent || '';
    const alreadyAsked = /nome.*(contacto|telem[oó]vel|whatsapp)|contacto.*nome/i.test(lastBot);
    if (!alreadyAsked) {
      window.addBubble?.('Para enviar este pedido ao Carlos, indique o seu nome e número de telemóvel ou WhatsApp.', 'bot');
    }
    window.setComposer?.('Ex.: Cristina, 989 999 999');
  }

  if (typeof originalSendMessage === 'function') {
    window.sendMessage = async function stableSendMessage(message) {
      const text = String(message || '').trim();
      if (!text) return;

      const isFreeQuestion = !window.state.pendingIntent && !window.state.finished;
      if (isFreeQuestion) pendingFreeRequest = text;

      await originalSendMessage(text);

      if (!pendingFreeRequest || window.state.finished) return;
      appendObservation(pendingFreeRequest);

      if (window.state.lead.nome && window.state.lead.telefone) {
        pendingFreeRequest = '';
        window.finishFlow?.();
        return;
      }

      requestContactForFreeQuestion();
    };
  }

  document.getElementById('startBtn')?.click();
});
