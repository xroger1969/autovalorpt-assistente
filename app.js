const PHONE = '351918404101';
const REQUEST_TIMEOUT_MS = 18000;
const STOCK_TIMEOUT_MS = 15000;
const $ = (id) => document.getElementById(id);

const EMPTY_LEAD = Object.freeze({
  nome: '', telefone: '', viatura: '', financiamento: '', retoma: '', visita: '', observacoes: ''
});

const state = {
  vehicle: null,
  lead: { ...EMPTY_LEAD },
  history: [],
  stock: [],
  selectedIntents: [],
  intentQueue: [],
  pendingIntent: '',
  finished: false,
  busy: false,
  stockRequest: 0
};

const INTENTS = {
  financiamento: {
    short: 'Financiamento',
    prompt: 'Indique a entrada pretendida e o prazo ou mensalidade aproximada.',
    retry: 'Não consegui validar os dados de financiamento. Indique uma entrada e um prazo ou mensalidade aproximada.',
    placeholder: 'Ex.: 3 000 € de entrada, 84 meses'
  },
  retoma: {
    short: 'Retoma',
    prompt: 'Indique marca, modelo, ano e quilómetros da sua viatura.',
    retry: 'Faltam dados da retoma. Indique marca, modelo, ano e quilómetros.',
    placeholder: 'Ex.: Renault Clio, 2019, 85 000 km'
  },
  visita: {
    short: 'Visita',
    prompt: 'Indique o dia e o horário preferidos. A visita só fica marcada depois da confirmação do Carlos.',
    retry: 'Não consegui identificar o dia e o horário. Pode escrever, por exemplo: dia 28 às 17h.',
    placeholder: 'Ex.: dia 28 às 17h'
  },
  contacto: {
    short: 'Contacto',
    prompt: 'Para enviar o pedido ao Carlos, indique o seu nome e número de telemóvel ou WhatsApp.',
    placeholder: 'Ex.: Cristina, 989 999 999'
  }
};

const ACTIONS = [
  ['disponibilidade', '✅', 'Confirmar disponibilidade'],
  ['financiamento', '💳', 'Financiamento'],
  ['retoma', '🔄', 'Tenho retoma'],
  ['visita', '📅', 'Preparar visita']
];

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text ?? '');
  return node;
}

function purgeSavedConversations() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('autovalorpt-assistente-')) localStorage.removeItem(key);
    }
  } catch {}
}

function setBusy(value) {
  state.busy = Boolean(value);
  const send = $('sendBtn');
  const input = $('messageInput');
  if (send) send.disabled = state.busy;
  if (input) input.disabled = state.busy;
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
  const chat = $('chat');
  if (!messages || !composer || !chat) return;

  const shouldFit = window.innerWidth <= 820 && chat.classList.contains('visible') && state.vehicle && !composer.hidden;
  if (!shouldFit) return resetMessageSizing();

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
    const messages = $('messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    fitMobileViewport();
  });
}

function addBubble(text, role = 'bot', remember = true, extraClass = '') {
  const messages = $('messages');
  if (!messages) return null;
  const bubble = el('div', `bubble ${role}${extraClass ? ` ${extraClass}` : ''}`, text);
  messages.appendChild(bubble);
  if (remember) state.history.push({ role: role === 'user' ? 'user' : 'assistant', content: String(text) });
  scrollEnd();
  return bubble;
}

function showTyping() {
  hideTyping();
  const bubble = el('div', 'bubble bot');
  bubble.id = 'typing';
  bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  $('messages')?.appendChild(bubble);
  scrollEnd();
}

function hideTyping() {
  $('typing')?.remove();
}

async function fetchJson(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
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
  if (!target) return;
  target.textContent = '';
  const rows = [
    ['Nome', state.lead.nome], ['Contacto', state.lead.telefone], ['Viatura', state.lead.viatura],
    ['Financiamento', state.lead.financiamento], ['Retoma', state.lead.retoma], ['Visita', state.lead.visita]
  ];
  for (const [label, value] of rows) {
    const row = el('div', 'summary-row');
    row.append(el('b', '', label), el('span', value ? '' : 'empty', value || 'Por indicar'));
    target.appendChild(row);
  }
  const url = whatsappUrl();
  if ($('sideWhatsApp')) $('sideWhatsApp').href = url;
  if ($('topWhatsApp')) $('topWhatsApp').href = url;
  document.querySelectorAll('.followup-main').forEach((link) => { link.href = url; });
}

function renderSelected() {
  const card = $('selectedCard');
  if (!card) return;
  card.textContent = '';
  card.appendChild(el('h2', '', 'Viatura selecionada'));
  if (!state.vehicle) return card.appendChild(el('div', 'selected-placeholder', 'A viatura escolhida aparecerá aqui.'));
  card.appendChild(imageBlock(state.vehicle, 'selected-image'));
  card.appendChild(el('div', 'selected-title', state.vehicle.title));
  const meta = metaValues(state.vehicle).join(' · ');
  if (meta) card.appendChild(el('div', 'selected-meta', meta));
  if (state.vehicle.price) card.appendChild(el('div', 'car-price', state.vehicle.price));
}

function setComposer(placeholder, hidden = false) {
  const composer = $('composer');
  const input = $('messageInput');
  if (composer) composer.hidden = hidden;
  if (input) input.placeholder = placeholder || 'Escreva a sua dúvida…';
}

function confirmationFor(intent) {
  if (intent === 'visita') return `✓ Data e horário compreendidos: ${state.lead.visita}. A visita fica sujeita à confirmação do Carlos.`;
  if (intent === 'contacto') return `✓ Obrigado, ${state.lead.nome}. O nome e o contacto foram registados corretamente.`;
  if (intent === 'financiamento') return `✓ Informação de financiamento compreendida: ${state.lead.financiamento}.`;
  if (intent === 'retoma') return `✓ Informação da retoma compreendida: ${state.lead.retoma}.`;
  return '✓ Resposta compreendida e registada corretamente.';
}

function addConfirmation(intent) {
  addBubble(confirmationFor(intent), 'bot', true, 'confirmed');
}

function updateSelectionControls(wrap) {
  const count = state.selectedIntents.length;
  const counter = wrap.querySelector('.selection-count');
  const button = wrap.querySelector('.continue-selection');
  if (counter) counter.textContent = count ? `${count} ${count === 1 ? 'opção selecionada' : 'opções selecionadas'}` : 'Selecione uma ou várias opções';
  if (button) {
    button.disabled = count === 0;
    button.textContent = count ? `Continuar com ${count}` : 'Continuar';
  }
}

function renderPurposeActions() {
  removeActionPanels();
  if (!state.vehicle) return;
  state.finished = false;
  state.pendingIntent = '';
  state.intentQueue = [];
  state.selectedIntents = [];
  $('chatTitle').textContent = 'O que pretende?';
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
      if (index >= 0) state.selectedIntents.splice(index, 1); else state.selectedIntents.push(intent);
      const selected = state.selectedIntents.includes(intent);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
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
  scrollEnd();
}

function beginSelectedIntents() {
  if (!state.selectedIntents.length || state.busy) return;
  removeActionPanels();
  state.intentQueue = state.selectedIntents.filter((intent) => ['financiamento', 'retoma', 'visita'].includes(intent));
  state.lead.observacoes = state.selectedIntents.includes('disponibilidade') ? 'Pedido de confirmação de disponibilidade.' : '';
  advanceIntent();
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
  whatsapp.textContent = 'Enviar pedido ao Carlos';
  const other = el('button', 'followup-secondary', 'Adicionar outros assuntos');
  other.type = 'button';
  other.addEventListener('click', renderPurposeActions);
  wrap.append(whatsapp, other);
  $('messages').appendChild(wrap);
  scrollEnd();
}

function finishFlow() {
  state.pendingIntent = '';
  state.finished = true;
  $('chatTitle').textContent = 'Pedido preparado';
  setComposer('Pode acrescentar uma observação…');
  renderSummary();
  renderFollowupActions();
}

function advanceIntent() {
  if (state.intentQueue.length) {
    const intent = state.intentQueue.shift();
    state.pendingIntent = intent;
    $('chatTitle').textContent = INTENTS[intent].short;
    addBubble(INTENTS[intent].prompt, 'bot');
    setComposer(INTENTS[intent].placeholder);
    return;
  }
  if (!state.lead.nome || !state.lead.telefone) {
    state.pendingIntent = 'contacto';
    $('chatTitle').textContent = INTENTS.contacto.short;
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
  return true;
}

function extractContact(text) {
  const compact = String(text).replace(/\s+/g, ' ').trim();
  const match = compact.match(/(?:\+?351[\s.-]*)?(9\d{2}[\s.-]?\d{3}[\s.-]?\d{3})/);
  const telefone = match ? match[1].replace(/\D/g, '') : '';
  let nome = compact.replace(match?.[0] || '', ' ').replace(/\b(nome|contacto|telefone|telemóvel|telemovel|whatsapp|sou|chamo-me)\b\s*[:=-]?/gi, ' ').replace(/[,;|/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-zÀ-ÿ'’\- ]{2,60}$/u.test(nome)) nome = '';
  nome = nome.split(' ').filter(Boolean).map((word) => word.charAt(0).toLocaleUpperCase('pt-PT') + word.slice(1).toLocaleLowerCase('pt-PT')).join(' ');
  return { nome, telefone };
}

function handleContact(text) {
  addBubble(text, 'user');
  const { nome, telefone } = extractContact(text);
  if (!nome || !telefone) {
    const missing = !nome && !telefone ? 'o nome e um número de telemóvel válido' : !nome ? 'o nome' : 'um número de telemóvel válido com 9 dígitos';
    addBubble(`Não consegui validar ${missing}. Escreva, por exemplo: Cristina 989 999 999.`, 'bot');
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
  const requestId = ++state.stockRequest;
  $('chatTitle').textContent = 'Escolha uma viatura';
  setComposer('', true);
  resetMessageSizing();
  $('messages').textContent = '';
  addBubble('Escolha uma viatura para continuar.', 'bot');
  const status = el('div', 'stock-status', 'A carregar fotografias e dados das viaturas…');
  status.id = 'stockStatus';
  $('messages').appendChild(status);
  try {
    const data = await fetchJson('/api/stock', {}, STOCK_TIMEOUT_MS);
    if (requestId !== state.stockRequest) return;
    state.stock = Array.isArray(data.results) ? data.results : [];
    status.remove();
    if (!state.stock.length) return addBubble(data.warning || 'Não consegui carregar o stock neste momento. Pode falar diretamente com o Carlos.', 'bot');
    renderStock(state.stock);
  } catch {
    if (requestId !== state.stockRequest) return;
    status.remove();
    addBubble('Não consegui carregar o stock neste momento. Tente novamente ou fale diretamente com o Carlos.', 'bot');
  }
}

function selectVehicle(item) {
  if (state.busy) return;
  state.vehicle = item;
  state.lead = { ...EMPTY_LEAD, viatura: item.title };
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  state.finished = false;
  $('messages').textContent = '';
  $('changeBtn').hidden = false;
  $('chatTitle').textContent = 'Viatura selecionada';
  renderSelected();
  renderSummary();
  addBubble(item.title, 'user');
  renderPurposeActions();
}

async function sendMessage(message) {
  const text = String(message || '').trim();
  if (!text || state.busy) return;
  if (state.pendingIntent === 'contacto') return handleContact(text);

  if (state.finished) {
    addBubble(text, 'user');
    state.lead.observacoes = [state.lead.observacoes, text].filter(Boolean).join(' | ').slice(0, 350);
    renderSummary();
    addBubble('✓ Observação acrescentada ao pedido.', 'bot', true, 'confirmed');
    renderFollowupActions();
    $('messageInput').value = '';
    return;
  }

  const currentIntent = state.pendingIntent;
  $('messageInput').value = '';
  removeActionPanels();
  addBubble(text, 'user');
  showTyping();
  setBusy(true);

  try {
    const data = await fetchJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        intent: currentIntent,
        contexto: { viatura: state.vehicle?.title || state.lead.viatura || '' },
        lead: state.lead,
        history: currentIntent ? [] : state.history.slice(-8, -1)
      })
    });
    if (data.lead) state.lead = { ...state.lead, ...data.lead };
    renderSummary();
    renderSelected();

    if (currentIntent) {
      if (intentComplete(currentIntent)) {
        state.pendingIntent = '';
        addConfirmation(currentIntent);
        advanceIntent();
      } else {
        addBubble(INTENTS[currentIntent]?.retry || 'Falta completar esta informação.', 'bot');
        setComposer(INTENTS[currentIntent]?.placeholder);
      }
    } else {
      addBubble(data.reply || 'Obrigado. O Carlos dará seguimento ao seu pedido.', 'bot');
      renderPurposeActions();
    }
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    addBubble(timedOut ? 'A resposta está a demorar mais do que o normal. Tente novamente.' : 'Não consegui responder automaticamente neste momento. Pode enviar o pedido diretamente ao Carlos.', 'bot');
    if (currentIntent) {
      state.pendingIntent = currentIntent;
      setComposer(INTENTS[currentIntent]?.placeholder);
    } else {
      renderFollowupActions();
    }
  } finally {
    hideTyping();
    setBusy(false);
    fitMobileViewport();
  }
}

function resetState() {
  state.vehicle = null;
  state.lead = { ...EMPTY_LEAD };
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  state.finished = false;
  state.busy = false;
  hideTyping();
  setBusy(false);
}

function enterChat() {
  $('welcome').hidden = true;
  $('chat').classList.add('visible');
  resetState();
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  loadStock();
}

function changeVehicle() {
  if (state.busy) return;
  resetState();
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  loadStock();
}

function resetAll() {
  if (state.busy) return;
  purgeSavedConversations();
  if (document.body.dataset.direct === 'true') {
    location.href = '/';
    return;
  }
  resetState();
  state.stock = [];
  state.stockRequest += 1;
  $('messages').textContent = '';
  setComposer('', true);
  $('chat').classList.remove('visible');
  $('welcome').hidden = false;
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  resetMessageSizing();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('startBtn')?.addEventListener('click', enterChat);
$('changeBtn')?.addEventListener('click', changeVehicle);
$('resetBtn')?.addEventListener('click', resetAll);
$('composer')?.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('messageInput')?.value);
});
window.addEventListener('resize', fitMobileViewport);
window.visualViewport?.addEventListener('resize', fitMobileViewport);
window.visualViewport?.addEventListener('scroll', fitMobileViewport);

purgeSavedConversations();
setComposer('', true);
renderSelected();
renderSummary();
resetMessageSizing();