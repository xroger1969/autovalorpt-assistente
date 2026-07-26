document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');

  const style = document.createElement('style');
  style.textContent = `
    @media(max-width:820px){
      #composer.choosing-options{position:static!important;bottom:auto!important;box-shadow:none!important}
    }
  `;
  document.head.appendChild(style);

  function syncOptionChoosingState() {
    const choosing = Boolean(document.getElementById('purposeActions'));
    composer?.classList.toggle('choosing-options', choosing);
  }

  function scrollToWritingArea() {
    if (window.innerWidth > 820 || !composer || composer.hidden) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const target = document.getElementById('freeQuestionBox') || composer;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }, 140);
    });
  }

  document.addEventListener('click', (event) => {
    const continueButton = event.target.closest('#purposeActions .continue-selection');
    if (!continueButton) return;
    setTimeout(() => {
      syncOptionChoosingState();
      scrollToWritingArea();
    }, 0);
  }, true);

  function hasValidatedRequest() {
    const lead = state?.lead || {};
    const structured = Boolean(
      String(lead.financiamento || '').trim() ||
      String(lead.retoma || '').trim() ||
      String(lead.visita || '').trim()
    );
    const availability = /pedido de confirma[cç][aã]o de disponibilidade/i.test(String(lead.observacoes || ''));
    return structured || availability;
  }

  function isReadyToSend() {
    const lead = state?.lead || {};
    return Boolean(
      state?.finished === true &&
      state?.vehicle &&
      String(lead.nome || '').trim().length >= 2 &&
      /^9\d{8}$/.test(String(lead.telefone || '').replace(/\D/g, '')) &&
      hasValidatedRequest()
    );
  }

  function enforceReadiness() {
    const ready = isReadyToSend();
    const partial = document.getElementById('quickSendPartial');
    const side = document.getElementById('sideWhatsApp');

    for (const element of [partial, side]) {
      if (!element) continue;
      const display = ready ? (element === side ? 'grid' : 'block') : 'none';
      if (element.hidden === ready) element.hidden = !ready;
      if (element.style.display !== display) element.style.setProperty('display', display, 'important');
      element.setAttribute('aria-hidden', String(!ready));
      if (ready) element.href = whatsappUrl();
      else element.removeAttribute('href');
    }
  }

  function syncUiGuards() {
    syncOptionChoosingState();
    enforceReadiness();
  }

  const observer = new MutationObserver(syncUiGuards);
  observer.observe(document.body, { childList: true, subtree: true });

  input?.addEventListener('input', enforceReadiness);
  document.addEventListener('click', () => setTimeout(syncUiGuards, 0), true);
  window.addEventListener('pageshow', syncUiGuards);

  const previousRenderSummary = renderSummary;
  renderSummary = function renderSummaryWithStrictSendReadiness() {
    previousRenderSummary();
    enforceReadiness();
  };

  const previousFinishFlow = finishFlow;
  finishFlow = function finishFlowWithStrictSendReadiness() {
    previousFinishFlow();
    syncUiGuards();
  };

  syncUiGuards();
});