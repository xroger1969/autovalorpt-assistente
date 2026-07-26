document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');

  function scrollToWritingArea() {
    if (window.innerWidth > 820 || !composer || composer.hidden) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const target = document.getElementById('freeQuestionBox') || composer;
        target.scrollIntoView({ behavior: 'smooth', block: 'end', inline: 'nearest' });
        setTimeout(() => {
          const rect = target.getBoundingClientRect();
          const viewportHeight = window.visualViewport?.height || window.innerHeight;
          if (rect.bottom > viewportHeight - 12) {
            window.scrollBy({ top: rect.bottom - viewportHeight + 18, behavior: 'smooth' });
          }
        }, 260);
      }, 80);
    });
  }

  document.addEventListener('click', (event) => {
    const option = event.target.closest('#purposeActions .quick');
    const continueButton = event.target.closest('#purposeActions .continue-selection');
    if (option || continueButton) scrollToWritingArea();
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
      element.hidden = !ready;
      element.style.setProperty('display', ready ? (element === side ? 'grid' : 'block') : 'none', 'important');
      element.setAttribute('aria-hidden', String(!ready));
      if (ready) element.href = whatsappUrl();
      else element.removeAttribute('href');
    }
  }

  const observer = new MutationObserver(() => enforceReadiness());
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });

  input?.addEventListener('input', enforceReadiness);
  document.addEventListener('click', () => setTimeout(enforceReadiness, 0), true);
  window.addEventListener('pageshow', enforceReadiness);

  const previousRenderSummary = renderSummary;
  renderSummary = function renderSummaryWithStrictSendReadiness() {
    previousRenderSummary();
    enforceReadiness();
  };

  const previousFinishFlow = finishFlow;
  finishFlow = function finishFlowWithStrictSendReadiness() {
    previousFinishFlow();
    enforceReadiness();
  };

  enforceReadiness();
});
