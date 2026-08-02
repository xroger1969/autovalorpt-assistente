document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const input = document.getElementById('messageInput');
  if (!composer || !input) return;

  const isMobile = () => window.innerWidth <= 820;
  const isAppleTouch = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const style = document.createElement('style');
  style.textContent = `
    @media(max-width:820px){
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
