const PHONE = '351918404101';
const $ = (id) => document.getElementById(id);

const EMPTY_LEAD = {
  nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', visita: '', observacoes: ''
};

const state = {
  vehicle: null,
  lead: { ...EMPTY_LEAD },
  history: [],
  stock: [],
  selectedIntents: [],
  intentQueue: [],
  pendingIntent: ''
};

const INTENTS = {
  financiamento: {
    short: 'Financiamento',
    prompt: 'Indique a entrada pretendida e o prazo ou mensalidade aproximada.',
    retry: 'Falta indicar a entrada e o prazo ou mensalidade pretendida.',
    placeholder: 'Ex.: 3 000 € de entrada, 84 meses'
  },
  retoma: {
    short: 'Retoma',
    prompt: 'Indique marca, modelo, ano e quilómetros da sua viatura.',
    retry: 'Falta indicar marca, modelo, ano e quilómetros da sua viatura.',
    placeholder: 'Ex.: Renault Clio, 2019, 85 000 km'
  },
  visita: {
    short: 'Visita',
    prompt: 'Indique o dia e o horário preferidos. A visita só fica marcada depois da confirmação do Carlos.',
    retry: 'Falta indicar o dia e o horário preferidos.',
    placeholder: 'Ex.: amanhã às 15:30'
  },
  contacto: {
    short: 'Contacto',
    prompt: 'Para enviar o pedido ao Carlos, indique o seu nome e número de telemóvel ou WhatsApp.',
    placeholder: 'Ex.: Fernando, 923 444 555'
  }
};

const ACTIONS = [
  ['disponibilidade', '✅', 'Confirmar disponibilidade'],
  ['financiamento', '💳', 'Financiamento'],
  ['retoma', '🔄', 'Tenho retoma'],
  ['visita', '📅', 'Preparar visita']
];

function purgeSavedConversations() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('autovalorpt-assistente-')) localStorage.removeItem(key);
    }
  } catch {}
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text || '');
  return node;
}

function removeActionPanels() {
  $('purposeActions')?.remove();
  $('followupActions')?.remove();
}

function resetMessageSizing() {
  const messages = $('messages');
  if (!messages) return;
  messages.style.removeProperty('height');
  messages.style.removeProperty('min-height');
  messages.style.removeProperty('max-height');
}

function fitMobileViewport() {
  const messages = $('messages');
  const composer = $('composer');
  if (!messages) return;

  const shouldFit = window.innerWidth <= 820 &&
    $('chat').classList.contains('visible') &&
    Boolean(state.vehicle) &&
    composer &&
    !composer.hidden;

  if (!shouldFit) {
    resetMessageSizing();
    return;
  }

  requestAnimationFrame(() => {
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const topbarHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
    const headHeight = document.querySelector('.chat-head')?.getBoundingClientRect().height || 0;
    const composerHeight = composer.getBoundingClientRect().height || 0;
    const available = Math.max(230, viewportHeight - topbarHeight - headHeight - composerHeight);
    messages.style.height = `${available}px`;
    messages.style.minHeight = '0';
    messages.style.maxHeight = `${available}px`;
  });
}

function scrollEnd() {
  requestAnimationFrame(() => {
    $('messages').scrollTop = $('messages').scrollHeight;
    fitMobileViewport();
  });
}

function addBubble(text, role = 'bot', remember = true) {
  const bubble = el('div', `bubble ${role}`, text);
  $('messages').appendChild(bubble);
  if (remember) state.history.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
  scrollEnd();
  return bubble;
}

function showTyping() {
  const bubble = el('div', 'bubble bot');
  bubble.id = 'typing';
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $('messages').appendChild(bubble);
  scrollEnd();
}

function hideTyping() {
  $('typing')?.remove();
}

function imageBlock(item, className) {
  const wrap = el('div', className);
  if (!item?.image) {
    wrap.appendChild(el('div', 'car-fallback', 'AV'));
    return wrap;
  }

  const img = document.createElement('img');
  img.src = item.image;
  img.alt = item.title || 'Viatura';
  img.loading = 'lazy';
  img.onerror = () => { wrap.innerHTML = '<div class="car-fallback">AV</div>'; };
  wrap.appendChild(img);
  return wrap;
}

function metaValues(item) {
  return [item?.year, item?.mileage, item?.fuel].filter(Boolean);
}

function whatsappText() {
  const lines = ['Olá Carlos, venho do assistente AutoValorPT.'];
  if (state.lead.viatura) lines.push(`Viatura: ${state.lead.viatura}`);
  if (state.selectedIntents.length) {
    const labels = state.selectedIntents.map((intent) => ACTIONS.find((action) => action[0] === intent)?.[2] || intent);
    lines.push(`Assuntos: ${labels.join(', ')}`);
  }
  if (state.lead.nome) lines.push(`Nome: ${state.lead.nome}`);
  if (state.lead.telefone) lines.push(`Contacto: ${state.lead.telefone}`);
  if (state.lead.financiamento) lines.push(`Financiamento: ${state.lead.financiamento}`);
  if (state.lead.retoma) lines.push(`Retoma: ${state.lead.retoma}`);
  if (state.lead.visita) lines.push(`Visita: ${state.lead.visita}`);
  if (state.lead.observacoes) lines.push(`Observações: ${state.lead.observacoes}`);
  return lines.join('\n');
}

function whatsappUrl() {
  return `https://wa.me/${PHONE}?text=${encodeURIComponent(whatsappText())}`;
}

function renderSummary() {
  const target = $('summary');
  target.textContent = '';
  const rows = [
    ['Nome', state.lead.nome],
    ['Contacto', state.lead.telefone],
    ['Viatura', state.lead.viatura],
    ['Financiamento', state.lead.financiamento],
    ['Retoma', state.lead.retoma],
    ['Visita', state.lead.visita]
  ];

  for (const [label, value] of rows) {
    const row = el('div', 'summary-row');
    row.append(el('b', '', label), el('span', value ? '' : 'empty', value || 'Por indicar'));
    target.appendChild(row);
  }

  const url = whatsappUrl();
  $('sideWhatsApp').href = url;
  $('topWhatsApp').href = url;
}

function renderSelected() {
  const card = $('selectedCard');
  card.textContent = '';
  card.appendChild(el('h2', '', 'Viatura selecionada'));

  if (!state.vehicle) {
    card.appendChild(el('div', 'selected-placeholder', 'A viatura escolhida aparecerá aqui.'));
    return;
  }

  card.appendChild(imageBlock(state.vehicle, 'selected-image'));
  card.appendChild(el('div', 'selected-title', state.vehicle.title));
  const meta = metaValues(state.vehicle).join(' · ');
  if (meta) card.appendChild(el('div', 'selected-meta', meta));
  if (state.vehicle.price) card.appendChild(el('div', 'car-price', state.vehicle.price));
}

function setComposer(placeholder) {
  $('messageInput').placeholder = placeholder || 'Escreva a sua dúvida…';
}

function updateSelectionControls(wrap) {
  const count = state.selectedIntents.length;
  const counter = wrap.querySelector('.selection-count');
  const continueButton = wrap.querySelector('.continue-selection');
  if (counter) counter.textContent = count ? `${count} ${count === 1 ? 'opção selecionada' : 'opções selecionadas'}` : 'Selecione uma ou várias opções';
  if (continueButton) {
    continueButton.disabled = count === 0;
    continueButton.textContent = count ? `Continuar com ${count}` : 'Continuar';
  }
}

function renderPurposeActions() {
  removeActionPanels();
  if (!state.vehicle) return;

  state.pendingIntent = '';
  state.intentQueue = [];
  state.selectedIntents = [];
  $('chatTitle').textContent = 'O que pretende?';
  $('composer').hidden = false;
  setComposer('Ou escreva uma pergunta sobre a viatura…');

  const wrap = el('section', 'action-panel');
  wrap.id = 'purposeActions';
  wrap.appendChild(el('div', 'action-heading', 'Pode escolher uma ou várias opções'));

  const grid = el('div', 'quick-actions');
  for (const [intent, icon, label] of ACTIONS) {
    const button = el('button', 'quick');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="quick-icon">${icon}</span><span class="quick-label">${label}</span><span class="selection-mark" aria-hidden="true">✓</span>`;
    button.addEventListener('click', () => {
      const index = state.selectedIntents.indexOf(intent);
      if (index >= 0) state.selectedIntents.splice(index, 1);
      else state.selectedIntents.push(intent);
      const selected = state.selectedIntents.includes(intent);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      updateSelectionControls(wrap);
    });
    grid.appendChild(button);
  }

  wrap.appendChild(grid);
  const footer = el('div', 'selection-footer');
  footer.appendChild(el('div', 'selection-count', 'Selecione uma ou várias opções'));
  const continueButton = el('button', 'continue-selection', 'Continuar');
  continueButton.type = 'button';
  continueButton.disabled = true;
  continueButton.addEventListener('click', beginSelectedIntents);
  footer.appendChild(continueButton);
  wrap.appendChild(footer);
  $('messages').appendChild(wrap);
  fitMobileViewport();
  scrollEnd();
}

function beginSelectedIntents() {
  if (!state.selectedIntents.length) return;
  removeActionPanels();
  state.intentQueue = state.selectedIntents.filter((intent) => ['financiamento', 'retoma', 'visita'].includes(intent));
  state.lead.observacoes = state.selectedIntents.includes('disponibilidade')
    ? 'Pedido de confirmação de disponibilidade.'
    : '';
  advanceIntent();
}

function finishFlow() {
  state.pendingIntent = '';
  $('chatTitle').textContent = 'Pedido preparado';
  renderFollowupActions();
  setComposer('Pode acrescentar uma observação…');
}

function advanceIntent() {
  if (state.intentQueue.length) {
    const intent = state.intentQueue.shift();
    const config = INTENTS[intent];
    state.pendingIntent = intent;
    $('chatTitle').textContent = config.short;
    addBubble(config.prompt, 'bot');
    setComposer(config.placeholder);
    return;
  }

  if (!state.lead.nome || !state.lead.telefone) {
    state.pendingIntent = 'contacto';
    $('chatTitle').textContent = 'Contacto';
    addBubble(INTENTS.contacto.prompt, 'bot');
    setComposer(INTENTS.contacto.placeholder);
    return;
  }

  finishFlow();
}

function intentComplete(intent) {
  if (intent === 'financiamento') return Boolean(state.lead.financiamento);
  if (intent === 'retoma') return Boolean(state.lead.retoma);
  if (intent === 'visita') return Boolean(state.lead.visita);
  if (intent === 'contacto') return Boolean(state.lead.nome && state.lead.telefone);
  return true;
}

function renderFollowupActions() {
  removeActionPanels();
  const wrap = el('div', 'followup-actions');
  wrap.id = 'followupActions';

  const whatsapp = document.createElement('a');
  whatsapp.className = 'followup-main';
  whatsapp.href = whatsappUrl();
  whatsapp.target = '_blank';
  whatsapp.rel = 'noopener';
  whatsapp.textContent = 'Continuar no WhatsApp';

  const other = el('button', 'followup-secondary', 'Adicionar outros assuntos');
  other.type = 'button';
  other.addEventListener('click', renderPurposeActions);
  wrap.append(whatsapp, other);
  $('messages').appendChild(wrap);
  scrollEnd();
}

function renderStock(items) {
  $('stockGrid')?.remove();
  $('stockStatus')?.remove();
  const grid = el('div', 'stock-grid');
  grid.id = 'stockGrid';

  for (const item of items) {
    const card = el('article', 'car');
    card.appendChild(imageBlock(item, 'car-image'));
    const body = el('div', 'car-body');
    body.appendChild(el('div', 'car-title', item.title));

    const meta = el('div', 'car-meta');
    for (const value of metaValues(item)) meta.appendChild(el('span', '', value));
    if (meta.children.length) body.appendChild(meta);
    if (item.price) body.appendChild(el('div', 'car-price', item.price));

    const actions = el('div', 'car-actions');
    const choose = el('button', 'choose', 'Escolher');
    choose.type = 'button';
    choose.addEventListener('click', () => selectVehicle(item));

    const view = document.createElement('a');
    view.className = 'view';
    view.textContent = 'Ver anúncio';
    view.href = item.url;
    view.target = '_blank';
    view.rel = 'noopener';
    actions.append(choose, view);
    body.appendChild(actions);
    card.appendChild(body);
    grid.appendChild(card);
  }

  $('messages').appendChild(grid);
  resetMessageSizing();
}

async function loadStock() {
  $('chatTitle').textContent = 'Escolha uma viatura';
  $('composer').hidden = true;
  resetMessageSizing();
  addBubble('Escolha uma viatura para continuar.', 'bot');
  const status = el('div', 'stock-status', 'A carregar fotografias e dados das viaturas…');
  status.id = 'stockStatus';
  $('messages').appendChild(status);

  try {
    const response = await fetch('/api/stock');
    const data = await response.json();
    state.stock = Array.isArray(data.results) ? data.results : [];
    status.remove();
    if (!state.stock.length) {
      addBubble(data.warning || 'Não consegui carregar o stock neste momento. Pode falar diretamente com o Carlos.', 'bot');
      return;
    }
    renderStock(state.stock);
  } catch {
    status.remove();
    addBubble('Não consegui carregar o stock neste momento. Tente novamente ou fale diretamente com o Carlos.', 'bot');
  }
}

function selectVehicle(item) {
  state.vehicle = item;
  state.lead = { ...EMPTY_LEAD, viatura: item.title };
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';

  $('messages').textContent = '';
  $('composer').hidden = false;
  $('changeBtn').hidden = false;
  $('chatTitle').textContent = 'Viatura selecionada';
  renderSelected();
  renderSummary();
  addBubble(item.title, 'user');
  addBubble('Boa escolha. Selecione os assuntos que pretende tratar.', 'bot');
  renderPurposeActions();
}

function incompleteMessage(intent) {
  if (intent === 'contacto') {
    if (state.lead.nome && !state.lead.telefone) return `Obrigado, ${state.lead.nome}. Falta apenas o número de telemóvel ou WhatsApp.`;
    if (!state.lead.nome && state.lead.telefone) return 'Obrigado. Falta apenas indicar o seu nome.';
    return INTENTS.contacto.prompt;
  }
  return INTENTS[intent]?.retry || 'Falta completar esta informação.';
}

async function sendMessage(message) {
  const text = String(message || '').trim();
  if (!text) return;

  const currentIntent = state.pendingIntent;
  const apiIntent = currentIntent === 'contacto' ? 'disponibilidade' : currentIntent;
  $('messageInput').value = '';
  $('sendBtn').disabled = true;
  removeActionPanels();
  addBubble(text, 'user');
  showTyping();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        intent: apiIntent,
        contexto: { viatura: state.vehicle?.title || state.lead.viatura || '' },
        lead: state.lead,
        history: currentIntent ? [] : state.history.slice(-8, -1)
      })
    });

    const data = await response.json();
    hideTyping();
    if (!response.ok) throw new Error(data.error || 'Erro');
    if (data.lead) state.lead = { ...state.lead, ...data.lead };

    if (currentIntent === 'contacto' && !state.selectedIntents.includes('disponibilidade') && state.lead.observacoes === 'Pedido de confirmação de disponibilidade.') {
      state.lead.observacoes = '';
    }

    renderSummary();
    renderSelected();

    if (currentIntent) {
      if (intentComplete(currentIntent)) {
        state.pendingIntent = '';
        advanceIntent();
      } else {
        addBubble(incompleteMessage(currentIntent), 'bot');
        setComposer(INTENTS[currentIntent]?.placeholder);
      }
    } else {
      addBubble(data.reply || 'Obrigado. O Carlos dará seguimento ao seu pedido.', 'bot');
      renderPurposeActions();
    }
  } catch {
    hideTyping();
    addBubble('Não consegui responder automaticamente neste momento. Pode continuar diretamente com o Carlos pelo WhatsApp.', 'bot');
    renderFollowupActions();
  } finally {
    $('sendBtn').disabled = false;
    fitMobileViewport();
  }
}

function enterChat() {
  $('welcome').hidden = true;
  $('chat').classList.add('visible');
  $('messages').textContent = '';
  $('composer').hidden = true;
  state.vehicle = null;
  state.lead = { ...EMPTY_LEAD };
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  resetMessageSizing();
  loadStock();
}

function changeVehicle() {
  $('messages').textContent = '';
  $('composer').hidden = true;
  state.vehicle = null;
  state.lead = { ...EMPTY_LEAD };
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  resetMessageSizing();
  loadStock();
}

function resetAll() {
  purgeSavedConversations();
  state.vehicle = null;
  state.lead = { ...EMPTY_LEAD };
  state.history = [];
  state.stock = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  $('messages').textContent = '';
  $('composer').hidden = true;
  $('chat').classList.remove('visible');
  $('welcome').hidden = false;
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  resetMessageSizing();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('startBtn').addEventListener('click', enterChat);
$('changeBtn').addEventListener('click', changeVehicle);
$('resetBtn').addEventListener('click', resetAll);
$('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('messageInput').value);
});

window.addEventListener('resize', fitMobileViewport);
window.visualViewport?.addEventListener('resize', fitMobileViewport);
window.visualViewport?.addEventListener('scroll', fitMobileViewport);

purgeSavedConversations();
$('composer').hidden = true;
renderSelected();
renderSummary();
resetMessageSizing();
