document.addEventListener('DOMContentLoaded', () => {
  const composer = document.getElementById('composer');
  const inputRow = composer?.querySelector('.input-row');
  const freeBox = document.getElementById('freeQuestionBox');
  const input = document.getElementById('messageInput');
  const privacy = composer?.querySelector('.privacy');
  if (!composer || !inputRow || !input) return;

  const appleMobile = /iPhone|iPad|iPod/i.test(window.navigator?.userAgent || '')
    || (window.navigator?.platform === 'MacIntel' && window.navigator?.maxTouchPoints > 1);
  const keyboardAccessoryClearance = appleMobile ? 64 : 0;

  // Mantém o campo na estrutura original do composer. No iOS, envolver o
  // input noutra caixa altera a altura calculada quando o teclado abre.
  if (freeBox) {
    composer.insertBefore(freeBox, privacy || null);
    composer.insertBefore(inputRow, privacy || null);
  }

  const style = document.createElement('style');
  style.textContent = `
    #freeQuestionBox{margin:0 0 10px;padding:14px;border:2px solid #9fc5f4;border-radius:15px;background:#f5f9ff}
    #freeQuestionBox .free-question-hint{margin-bottom:0}
    #composer .input-row{position:relative;z-index:2}
    #composer .input-row input{min-height:58px;border:2px solid #c5d9f2;background:#fff;font-size:18px;line-height:1.35}
    #composer.keyboard-open #freeQuestionBox{display:block!important}
    #composer.keyboard-open #quickSendPartial{display:none!important}
    @media(max-width:820px){
      #composer{padding-top:9px;background:#fff}
      #composer.keyboard-open{
        position:fixed;
        left:0;
        right:0;
        bottom:0;
        z-index:30;
        max-height:calc(var(--visual-viewport-height, 100dvh) - var(--keyboard-accessory-clearance, 0px) - 8px);
        padding:9px 12px calc(9px + env(safe-area-inset-bottom) + var(--keyboard-accessory-clearance, 0px));
        overflow-y:auto;
        overscroll-behavior:contain;
        -webkit-overflow-scrolling:touch;
        transform:translate3d(0,var(--keyboard-translate-y, 0px),0);
        box-shadow:0 -8px 24px rgba(18,32,51,.10)
      }
      #composer.keyboard-open .privacy{display:none}
      #composer.keyboard-open .input-row input{font-size:18px}
    }
  `;
  document.head.appendChild(style);

  function keyboardOpen() {
    if (window.innerWidth > 820) return false;
    // Em algumas fases do Safari no iOS, innerHeight e visualViewport.height
    // encolhem em conjunto. Nesses casos a diferença abaixo é zero apesar de
    // o teclado estar aberto; o foco é o sinal fiável nos dispositivos Apple.
    if (appleMobile) return true;
    const viewport = window.visualViewport;
    return Boolean(viewport && window.innerHeight - viewport.height > 150);
  }

  function keyboardTranslation(viewport) {
    const viewportHeight = Math.round(viewport?.height || window.innerHeight);
    const viewportOffsetTop = Math.round(viewport?.offsetTop || 0);

    // Remove primeiro qualquer correção anterior para medir a posição que o
    // próprio browser atribuiu ao compositor neste evento do teclado.
    composer.style.setProperty('--keyboard-translate-y', '0px');
    const measuredBottom = Number(composer.getBoundingClientRect().bottom);
    const composerBottom = Number.isFinite(measuredBottom) ? measuredBottom : window.innerHeight;

    // Safari já devolveu estas coordenadas relativamente ao visual viewport e
    // ao layout viewport em diferentes estados. Escolher a menor correção
    // ancora a caixa sem voltar a aplicar o deslocamento que o iOS já fez.
    const safeVisualBottom = viewportHeight - keyboardAccessoryClearance;
    const safeLayoutBottom = viewportOffsetTop + safeVisualBottom;
    const corrections = [
      Math.round(safeVisualBottom - composerBottom),
      Math.round(safeLayoutBottom - composerBottom)
    ];
    return corrections.reduce((closest, current) => (
      Math.abs(current) < Math.abs(closest) ? current : closest
    ));
  }

  function syncKeyboardState() {
    const open = document.activeElement === input && keyboardOpen();
    composer.classList.toggle('keyboard-open', open);
    if (open) {
      const viewport = window.visualViewport;
      const translateY = keyboardTranslation(viewport);
      composer.style.setProperty('--keyboard-translate-y', `${translateY}px`);
      composer.style.setProperty('--visual-viewport-height', `${Math.round(viewport?.height || window.innerHeight)}px`);
      composer.style.setProperty('--keyboard-accessory-clearance', `${keyboardAccessoryClearance}px`);
      requestAnimationFrame(() => {
        const messages = document.getElementById('messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
        input.focus({ preventScroll: true });
      });
    } else {
      composer.style.removeProperty('--keyboard-translate-y');
      composer.style.removeProperty('--visual-viewport-height');
      composer.style.removeProperty('--keyboard-accessory-clearance');
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
    composer.style.removeProperty('--keyboard-translate-y');
    composer.style.removeProperty('--visual-viewport-height');
    composer.style.removeProperty('--keyboard-accessory-clearance');
    setTimeout(() => {
      if (typeof fitMobileViewport === 'function') fitMobileViewport();
    }, 80);
  });
  window.visualViewport?.addEventListener('resize', syncKeyboardState);
  window.visualViewport?.addEventListener('scroll', syncKeyboardState);
});

document.addEventListener('DOMContentLoaded', () => {
  const emptyTradeIn = () => ({ description: '', year: '', mileage: '' });
  let tradeInDraft = emptyTradeIn();

  function cleanSpaces(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeRegistration(value = '') {
    const compact = String(value)
      .toLocaleUpperCase('pt-PT')
      .replace(/\bMATR[IÍ]CULA\b\s*[:=-]?/giu, '')
      .replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{6}$/.test(compact)) return '';
    const portugueseFormats = [
      /^[A-Z]{2}\d{4}$/,
      /^\d{4}[A-Z]{2}$/,
      /^\d{2}[A-Z]{2}\d{2}$/,
      /^[A-Z]{2}\d{2}[A-Z]{2}$/
    ];
    if (!portugueseFormats.some((pattern) => pattern.test(compact))) return '';
    return compact.match(/.{2}/g).join('-');
  }

  function askForRegistration() {
    state.pendingIntent = 'matricula';
    document.getElementById('chatTitle').textContent = INTENTS.matricula.short;
    addBubble('Para concluir o pedido de avaliação, indique a matrícula da sua viatura de retoma.', 'bot');
    setFocusedTradeInPrompt(
      '💬 Indique a matrícula da retoma',
      'Escreva a matrícula da sua viatura.',
      INTENTS.matricula.placeholder
    );
  }

  function isTradeInQuestion(value = '') {
    const normalized = cleanSpaces(value)
      .toLocaleLowerCase('pt-PT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return /\b(retoma|retomas)\b/.test(normalized);
  }

  function titleCaseVehicle(value = '') {
    return cleanSpaces(value)
      .split(' ')
      .filter(Boolean)
      .map((word) => {
        if (/^\d+$/.test(word)) return word;
        if (/^[A-Za-zÀ-ÿ]{1,2}$/u.test(word)) return word.toLocaleUpperCase('pt-PT');
        return word.charAt(0).toLocaleUpperCase('pt-PT') + word.slice(1).toLocaleLowerCase('pt-PT');
      })
      .join(' ');
  }

  function formatMileage(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '';
    return `${new Intl.NumberFormat('pt-PT').format(Math.round(number))} km`;
  }

  function parseTradeInPart(value = '') {
    const original = cleanSpaces(value);
    let working = original;
    let year = '';
    let mileage = '';

    const yearMatch = [...working.matchAll(/\b(19[8-9]\d|20[0-2]\d)\b/g)]
      .reduce((best, current) => {
        if (!best) return current;
        return Number(current[1]) >= Number(best[1]) ? current : best;
      }, null);
    if (yearMatch) {
      year = yearMatch[1];
      const start = yearMatch.index;
      working = `${working.slice(0, start)} ${working.slice(start + yearMatch[0].length)}`;
    }

    const thousandMatch = working.match(/\b(\d{1,3})\s*mil(?:\s*(?:km|kms|quil[oó]metros?))?\b/i);
    if (thousandMatch) {
      mileage = String(Number(thousandMatch[1]) * 1000);
      working = working.replace(thousandMatch[0], ' ');
    }

    if (!mileage) {
      const explicitMileage = working.match(/\b(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*(?:km|kms|quil[oó]metros?)\b/i);
      if (explicitMileage) {
        mileage = explicitMileage[1].replace(/\D/g, '');
        working = working.replace(explicitMileage[0], ' ');
      }
    }

    if (!mileage && year) {
      const implicitMileage = working.match(/\b(\d{1,3}(?:[ .]\d{3})+|\d{5,6})\b/);
      const remainingDescription = implicitMileage
        ? working.replace(implicitMileage[0], ' ')
        : '';
      const mileageNumber = Number(implicitMileage?.[1].replace(/\D/g, ''));
      if (
        implicitMileage &&
        /[A-Za-zÀ-ÿ]/u.test(remainingDescription) &&
        Number.isFinite(mileageNumber) &&
        mileageNumber >= 1000 &&
        mileageNumber <= 999999
      ) {
        mileage = String(mileageNumber);
        working = remainingDescription;
      }
    }

    if (!mileage && tradeInDraft.description && tradeInDraft.year) {
      const numberOnly = working.match(/^\s*(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*$/);
      if (numberOnly) {
        mileage = numberOnly[1].replace(/\D/g, '');
        working = '';
      }
    }

    const description = titleCaseVehicle(
      working
        .replace(/\b(?:marca|modelo|ano|quil[oó]metros?|kms?|viatura|carro)\b\s*[:=-]?/gi, ' ')
        .replace(/[,;|/\\]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

    return { description, year, mileage };
  }

  function mergeTradeIn(part) {
    if (part.description) tradeInDraft.description = part.description;
    if (part.year) tradeInDraft.year = part.year;
    if (part.mileage) tradeInDraft.mileage = part.mileage;
  }

  function formattedTradeIn() {
    return [
      tradeInDraft.description,
      tradeInDraft.year,
      formatMileage(tradeInDraft.mileage)
    ].filter(Boolean).join(', ');
  }

  function setFocusedTradeInPrompt(title, hint, placeholder) {
    setComposer(placeholder);
    const promptTitle = document.querySelector('.free-question-title');
    const promptHint = document.querySelector('.free-question-hint');
    if (promptTitle) promptTitle.textContent = title;
    if (promptHint) promptHint.textContent = hint;
  }

  function askOnlyMissingTradeInData() {
    const missingDescription = !tradeInDraft.description;
    const missingYear = !tradeInDraft.year;
    const missingMileage = !tradeInDraft.mileage;
    const vehicle = tradeInDraft.description ? `o ${tradeInDraft.description}` : 'a sua viatura';

    if (!missingDescription && !missingYear && missingMileage) {
      addBubble(`Perfeito. Registei ${vehicle}, de ${tradeInDraft.year}. Falta só indicar quantos quilómetros tem atualmente.`, 'bot');
      setFocusedTradeInPrompt('💬 Só faltam os quilómetros', 'Indique apenas a quilometragem atual da viatura.', 'Ex.: 85 000 km');
      return;
    }

    if (!missingDescription && missingYear && !missingMileage) {
      addBubble(`Perfeito. Registei ${vehicle}, com ${formatMileage(tradeInDraft.mileage)}. De que ano é?`, 'bot');
      setFocusedTradeInPrompt('💬 Só falta o ano', 'Indique apenas o ano da viatura.', 'Ex.: 2019');
      return;
    }

    if (missingDescription && !missingYear && !missingMileage) {
      addBubble(`Obrigado. Registei o ano ${tradeInDraft.year} e ${formatMileage(tradeInDraft.mileage)}. Qual é a marca e o modelo da viatura?`, 'bot');
      setFocusedTradeInPrompt('💬 Só falta a viatura', 'Indique apenas a marca e o modelo.', 'Ex.: Renault Clio');
      return;
    }

    if (!missingDescription && missingYear && missingMileage) {
      addBubble(`Perfeito. Registei ${vehicle}. Falta indicar o ano e quantos quilómetros tem atualmente.`, 'bot');
      setFocusedTradeInPrompt('💬 Complete a retoma', 'Indique o ano e os quilómetros da viatura.', 'Ex.: 2019, 85 000 km');
      return;
    }

    if (missingDescription && !missingYear && missingMileage) {
      addBubble(`Obrigado. Registei o ano ${tradeInDraft.year}. Falta indicar a marca, o modelo e os quilómetros.`, 'bot');
      setFocusedTradeInPrompt('💬 Complete a retoma', 'Indique a marca, o modelo e os quilómetros.', 'Ex.: Renault Clio, 85 000 km');
      return;
    }

    if (missingDescription && missingYear && !missingMileage) {
      addBubble(`Obrigado. Registei ${formatMileage(tradeInDraft.mileage)}. Falta indicar a marca, o modelo e o ano da viatura.`, 'bot');
      setFocusedTradeInPrompt('💬 Complete a retoma', 'Indique a marca, o modelo e o ano.', 'Ex.: Renault Clio, 2019');
      return;
    }

    addBubble('Indique a marca, o modelo, o ano e os quilómetros da sua viatura.', 'bot');
    setFocusedTradeInPrompt('💬 Descreva a sua retoma', 'Pode responder numa única mensagem.', 'Ex.: Renault Clio, 2019, 85 000 km');
  }

  const previousSendMessage = sendMessage;
  sendMessage = async function sendMessageWithProgressiveTradeIn(message) {
    const text = cleanSpaces(message);
    if (!text || state.busy) return;

    if (
      !state.pendingIntent &&
      !String(state.lead?.retoma || '').trim() &&
      isTradeInQuestion(text)
    ) {
      document.getElementById('messageInput').value = '';
      removeActionPanels();
      state.finished = false;
      state.pendingIntent = 'retoma';
      document.getElementById('chatTitle').textContent = INTENTS.retoma.short;
      addBubble(text, 'user');
      addBubble(
        'Sim, aceitamos retomas. Para analisarmos a sua viatura, indique a marca, o modelo, o ano e a quilometragem.',
        'bot'
      );
      setFocusedTradeInPrompt(
        '💬 Descreva a sua retoma',
        'Pode responder numa única mensagem.',
        'Ex.: Renault Clio, 2019, 85 000 km'
      );
      return;
    }

    if (state.pendingIntent === 'matricula') {
      document.getElementById('messageInput').value = '';
      addBubble(text, 'user');
      const registration = normalizeRegistration(text);
      if (!registration) {
        addBubble(INTENTS.matricula.retry, 'bot');
        state.pendingIntent = 'matricula';
        setFocusedTradeInPrompt(
          '💬 Indique a matrícula da retoma',
          'Use a matrícula portuguesa da sua viatura.',
          INTENTS.matricula.placeholder
        );
        return;
      }

      state.lead.matricula = registration;
      state.pendingIntent = '';
      renderSummary();
      renderSelected();
      addConfirmation('matricula');
      tradeInDraft = emptyTradeIn();
      advanceIntent();
      return;
    }

    if (state.pendingIntent !== 'retoma') {
      return previousSendMessage(message);
    }

    document.getElementById('messageInput').value = '';
    addBubble(text, 'user');
    mergeTradeIn(parseTradeInPart(text));

    const collected = formattedTradeIn();
    if (collected) {
      state.lead.retoma = collected;
      renderSummary();
      renderSelected();
    }

    const complete = Boolean(tradeInDraft.description && tradeInDraft.year && tradeInDraft.mileage);
    if (!complete) {
      state.pendingIntent = 'retoma';
      askOnlyMissingTradeInData();
      return;
    }

    state.lead.retoma = formattedTradeIn();
    renderSummary();
    renderSelected();
    addConfirmation('retoma');
    askForRegistration();
  };

  const previousResetState = resetState;
  resetState = function resetStateWithTradeInDraft() {
    tradeInDraft = emptyTradeIn();
    return previousResetState();
  };

  const previousSelectVehicle = selectVehicle;
  selectVehicle = function selectVehicleWithCleanTradeInDraft(item) {
    tradeInDraft = emptyTradeIn();
    return previousSelectVehicle(item);
  };
});
