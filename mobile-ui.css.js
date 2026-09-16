document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  if (!composer || !input) return;

  const isMobile = () => window.innerWidth <= 820;
  const isAppleTouch = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const style = document.createElement('style');
  style.textContent = `
    .followup-actions{
      grid-template-columns:1fr!important;
      gap:10px!important;
      margin:12px 0 18px!important;
    }
    .followup-main,
    #quickSendPartial{
      width:100%!important;
      min-height:76px!important;
      padding:16px 20px!important;
      border:0!important;
      border-radius:19px!important;
      background:#15905f!important;
      color:#fff!important;
      text-decoration:none!important;
      text-align:center!important;
      font-size:20px!important;
      line-height:1.25!important;
      font-weight:950!important;
      letter-spacing:-.01em!important;
      box-shadow:0 12px 28px rgba(21,144,95,.24)!important;
    }
    .followup-main::before,
    #quickSendPartial::before{
      content:'💬';
      margin-right:9px;
      font-size:22px;
    }
    .followup-secondary{
      min-height:46px!important;
    }
    @media(max-width:820px){
      .followup-main,
      #quickSendPartial{
        min-height:82px!important;
        padding:18px 16px!important;
        border-radius:20px!important;
        font-size:21px!important;
      }
      #composer.keyboard-open{
        position:fixed!important;
        left:0!important;
        right:0!important;
        bottom:auto!important;
        transform:none!important;
        z-index:60!important;
        max-height:none!important;
        overflow:visible!important;
        padding:8px 12px calc(8px + env(safe-area-inset-bottom))!important;
        background:#fff!important;
        box-shadow:0 -8px 24px rgba(18,32,51,.12)!important;
      }
      #composer.keyboard-open #freeQuestionBox{display:none!important}
      #composer.keyboard-open .privacy{display:none!important}
      #composer.keyboard-open .input-row{margin:0!important}
    }
  `;
  document.head.appendChild(style);

  function emphasizeFinalWhatsAppButton(root = document) {
    root.querySelectorAll?.('.followup-main, #quickSendPartial').forEach((button) => {
      if (button.dataset.finalWhatsappReady === '1') return;
      button.textContent = 'Enviar agora pelo WhatsApp ao Carlos';
      button.setAttribute('aria-label', 'Enviar agora pelo WhatsApp ao Carlos');
      button.dataset.finalWhatsappReady = '1';
    });
  }

  emphasizeFinalWhatsAppButton();
  const finalButtonObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('.followup-main, #quickSendPartial')) emphasizeFinalWhatsAppButton(node.parentElement || document);
        else if (node.querySelector?.('.followup-main, #quickSendPartial')) emphasizeFinalWhatsAppButton(node);
      }
    }
  });
  finalButtonObserver.observe(document.body, { childList: true, subtree: true });

  function anchorComposer() {
    if (!isMobile() || document.activeElement !== input) return;
    const vv = window.visualViewport;
    if (!vv) return;

    composer.classList.add('keyboard-open');

    requestAnimationFrame(() => {
      const rect = composer.getBoundingClientRect();
      const composerHeight = Math.ceil(rect.height || composer.offsetHeight || 74);
      const visualTop = Math.round(vv.offsetTop || 0);
      const visualHeight = Math.round(vv.height || window.innerHeight);
      const accessoryGap = isAppleTouch ? 10 : 4;
      const top = Math.max(visualTop + 4, visualTop + visualHeight - composerHeight - accessoryGap);

      composer.style.setProperty('top', `${top}px`, 'important');
      composer.style.setProperty('bottom', 'auto', 'important');
      composer.style.setProperty('transform', 'none', 'important');

      const messages = document.getElementById('messages');
      if (messages) {
        const available = Math.max(180, top - messages.getBoundingClientRect().top - 8);
        messages.style.setProperty('height', `${available}px`);
        messages.style.setProperty('max-height', `${available}px`);
        messages.scrollTop = messages.scrollHeight;
      }
    });
  }

  function releaseComposer() {
    composer.style.removeProperty('top');
    composer.style.removeProperty('bottom');
    composer.style.removeProperty('transform');
    const messages = document.getElementById('messages');
    if (messages) {
      messages.style.removeProperty('height');
      messages.style.removeProperty('max-height');
    }
  }

  input.addEventListener('focus', () => {
    setTimeout(anchorComposer, 50);
    setTimeout(anchorComposer, 180);
    setTimeout(anchorComposer, 360);
  });

  input.addEventListener('blur', () => {
    setTimeout(releaseComposer, 80);
  });

  window.visualViewport?.addEventListener('resize', anchorComposer);
  window.visualViewport?.addEventListener('scroll', anchorComposer);
  window.addEventListener('orientationchange', () => setTimeout(anchorComposer, 250));
});