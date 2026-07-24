document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const inputRow = composer?.querySelector('.input-row');
  const freeBox = document.getElementById('freeQuestionBox');
  const input = document.getElementById('messageInput');
  const privacy = composer?.querySelector('.privacy');
  if (!composer || !inputRow || !input) return;

  // Mantém o campo na estrutura original do composer. No iOS, envolver o
  // input noutra caixa altera a altura calculada quando o teclado abre.
  if (freeBox) {
    composer.insertBefore(freeBox, inputRow);
    composer.insertBefore(inputRow, privacy || null);
  }

  const style = document.createElement('style');
  style.textContent = `
    #freeQuestionBox{margin:0 0 9px;padding:10px 12px;border:2px solid #9fc5f4;border-radius:15px;background:#f5f9ff}
    #freeQuestionBox .free-question-hint{margin-bottom:0}
    #composer .input-row{position:relative;z-index:2}
    #composer .input-row input{border:2px solid #c5d9f2;background:#fff}
    #composer.keyboard-open #freeQuestionBox,
    #composer.keyboard-open #quickSendPartial{display:none!important}
    @media(max-width:820px){
      #composer{padding-top:9px;background:#fff}
      #composer.keyboard-open{position:fixed;left:0;right:0;bottom:0;z-index:30;padding:9px 12px calc(9px + env(safe-area-inset-bottom));box-shadow:0 -8px 24px rgba(18,32,51,.10)}
      #composer.keyboard-open .privacy{display:none}
      #composer.keyboard-open .input-row input{font-size:16px}
    }
  `;
  document.head.appendChild(style);

  function keyboardOpen() {
    if (window.innerWidth > 820) return false;
    const viewport = window.visualViewport;
    return Boolean(viewport && window.innerHeight - viewport.height > 150);
  }

  function syncKeyboardState() {
    const open = document.activeElement === input && keyboardOpen();
    composer.classList.toggle('keyboard-open', open);
    if (open) {
      requestAnimationFrame(() => {
        inputRow.scrollIntoView({ block: 'end', behavior: 'auto' });
        input.focus({ preventScroll: true });
      });
    }
    setTimeout(() => {
      if (typeof fitMobileViewport === 'function') fitMobileViewport();
    }, 30);
  }

  input.addEventListener('focus', () => {
    setTimeout(syncKeyboardState, 120);
    setTimeout(syncKeyboardState, 320);
  });
  input.addEventListener('blur', () => {
    composer.classList.remove('keyboard-open');
    setTimeout(() => {
      if (typeof fitMobileViewport === 'function') fitMobileViewport();
    }, 80);
  });
  window.visualViewport?.addEventListener('resize', syncKeyboardState);
  window.visualViewport?.addEventListener('scroll', syncKeyboardState);
});
