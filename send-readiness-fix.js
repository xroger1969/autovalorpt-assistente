document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');

  const style = document.createElement('style');
  style.textContent = `
    @media(max-width:820px){
      #composer.choosing-options{display:none!important}
      #purposeActions{margin-bottom:calc(22px + env(safe-area-inset-bottom))!important}
      #purposeActions .selection-footer{position:sticky;bottom:0;z-index:12;margin:14px -14px -14px;padding:14px;background:rgba(248,251,255,.97);border-top:1px solid #dce6f2;box-shadow:0 -10px 24px rgba(18,32,51,.10);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
      #purposeActions .continue-selection{min-height:58px;font-size:18px;border-radius:16px}
    }
  `;
  document.head.appendChild(style);

  function syncOptionChoosingState() {
    const choosing = Boolean(document.getElementById('purposeActions'));
    composer?.classList.toggle('choosing-options', choosing);
    if (choosing) composer?.setAttribute('aria-hidden', 'true');
    else composer?.removeAttribute('aria-hidden');
    setTimeout(() => {
      if (typeof fitMobileViewport === 'function') fitMobileViewport();
    }, 0);
  }

  function scrollToWritingArea() {
    if (window.innerWidth > 820 || !composer || composer.hidden) return;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const target = document.getElementById('freeQuestionBox') || composer;
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }, 160);
    });
  }

  document.addEventListener('click', (event) => {
    const continueButton = event.target.closest('#purposeActions .continue-selection');
    if (!continueButton) return;
    setTimeout(() => {
      syncOptionChoosingState();
      scrollToWritingArea();
    }, 40);
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

  const sentAlerts = new Set();

  function alertKey() {
    const lead = state?.lead || {};
    return [
      String(lead.telefone || '').replace(/\D/g, ''),
      String(lead.viatura || ''),
      String(lead.visita || ''),
      String(lead.financiamento || ''),
      String(lead.retoma || ''),
      String(lead.observacoes || '')
    ].join('|');
  }

  function notifyReadyLead() {
    if (!isReadyToSend()) return;
    const key = alertKey();
    if (!key || sentAlerts.has(key)) return;

    const text = typeof whatsappText === 'function' ? whatsappText() : '';
    if (!text.startsWith('Olá Carlos, venho do assistente AutoValorPT.')) return;

    sentAlerts.add(key);
    fetch('/api/notify-lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ text })
    }).then((response) => {
      if (!response.ok) sentAlerts.delete(key);
    }).catch(() => sentAlerts.delete(key));
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

    if (ready) notifyReadyLead();
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

  // Fallback: se o browser adiar a chamada automática, o clique no WhatsApp volta a tentar.
  // A chave acima impede notificações duplicadas.
  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href*="wa.me/"]');
    if (!anchor || !isReadyToSend()) return;
    notifyReadyLead();
  }, true);

  syncUiGuards();
});