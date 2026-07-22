const PHONE = '351918404101';
const STORAGE_KEY = 'autovalorpt-assistente-v4';
const MAX_AGE = 24 * 60 * 60 * 1000;
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
  disponibilidade: {
    label: 'Confirmar disponibilidade',
    short: 'Disponibilidade',
    prompt: 'Para o Carlos confirmar esta viatura, indique o seu nome e o número de telemóvel ou WhatsApp.',
    placeholder: 'Ex.: Fernando, 923 444 555'
  },
  financiamento: {
    label: 'Financiamento',
    short: 'Financiamento',
    prompt: 'Indique a entrada pretendida e o prazo ou mensalidade aproximada. O valor final será sempre confirmado pelo Carlos e pela entidade financeira.',
    placeholder: 'Ex.: 3 000 € de entrada, 84 meses'
  },
  retoma: {
    label: 'Tenho retoma',
    short: 'Retoma',
    prompt: 'Indique marca, modelo, ano e quilómetros da sua viatura. A avaliação e o valor serão feitos pelo Carlos.',
    placeholder: 'Ex.: Renault Clio, 2019, 85 000 km'
  },
  visita: {
    label: 'Preparar visita',
    short: 'Visita',
    prompt: 'Indique o dia e o horário preferidos. A visita só fica marcada depois da confirmação do Carlos.',
    placeholder: 'Ex.: amanhã às 15:30'
  }
};

const ACTIONS = [
  ['disponibilidade', '✅', 'Confirmar disponibilidade'],
  ['financiamento', '💳', 'Financiamento'],
  ['retoma', '🔄', 'Tenho retoma'],
  ['visita', '📅', 'Preparar visita']
];

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      at: Date.now(),
      vehicle: state.vehicle,
      lead: state.lead,
      history: state.history.slice(-18),
      selectedIntents: state.selectedIntents,
      intentQueue: state.intentQueue,
      pendingIntent: state.pendingIntent
    }));
  } catch {}
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!saved || Date.now() - saved.at > MAX_AGE) return false;
    state.vehicle = saved.vehicle || null;
    state.lead = { ...EMPTY_LEAD, ...(saved.lead || {}) };
    state.history = Array.isArray(saved.history) ? saved.history : [];
    state.selectedIntents = Array.isArray(saved.selectedIntents) ? saved.selectedIntents.filter((item) => INTENTS[item]) : [];
    state.intentQueue = Array.isArray(saved.intentQueue) ? saved.intentQueue.filter((item) => INTENTS[item]) : [];
    state.pendingIntent = INTENTS[saved.pendingIntent] ? saved.pendingIntent : '';
    return Boolean(state.vehicle || state.history.length);
  } catch {
    return false;
  }
}

function clearState() {
  localStorage.removeItem(STORAGE_KEY);
  state.vehicle = null;
  state.lead = { ...EMPTY_LEAD };
  state.history = [];
  state.stock = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
}

function safeText(value = '') { return String(value || ''); }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = safeText(text);
  return node;
}

function removeActionPanels() {
  $('purposeActions')?.remove();
  $('followupActions')?.remove();
}

function scrollEnd() {
  requestAnimationFrame(() => { $('messages').scrollTop = $('messages').scrollHeight; });
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
function hideTyping() { $('typing')?.remove(); }

function imageBlock(item, className) {
  const wrap = el('div', className);
  if (item?.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = item.title || 'Viatura';
    img.loading = 'lazy';
    img.onerror = () => { wrap.innerHTML = '<div class="car-fallback">AV</div>'; };
    wrap.appendChild(img);
  } else {
    wrap.appendChild(el('div', 'car-fallback', 'AV'));
  }
  return wrap;
}

function metaValues(item) { return [item?.year, item?.mileage, item?.fuel].filter(Boolean); }

function whatsappText() {
  const lines = ['Olá Carlos, venho do assistente AutoValorPT.'];
  if (state.lead.viatura) lines.push(`Viatura: ${state.lead.viatura}`);
  if (state.selectedIntents.length) lines.push(`Assuntos: ${state.selectedIntents.map((item) => INTENTS[item]?.short || item).join(', ')}`);
  if (state.lead.nome) lines.push(`Nome: ${state.lead.nome}`);
  if (state.lead.telefone) lines.push(`Contacto: ${state.lead.telefone}`);
  if (state.lead.financiamento) lines.push(`Financiamento: ${state.lead.financiamento}`);
  if (state.lead.retoma) lines.push(`Retoma: ${state.lead.retoma}`);
  if (state.lead.visita) lines.push(`Visita: ${state.lead.visita}`);
  if (state.lead.observacoes) lines.push(`Observações: ${state.lead.observacoes}`);
  return lines.join('\n');
}
function whatsappUrl() { return `https://wa.me/${PHONE}?text=${encodeURIComponent(whatsappText())}`; }

function renderSummary() {
  const target = $('summary');
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
  $('sideWhatsApp').href = url;
  $('topWhatsApp').href = url;
  save();
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

function renderPurposeActions(clearSelection = true) {
  removeActionPanels();
  if (!state.vehicle) return;
  state.pendingIntent = '';
  state.intentQueue = [];
  if (clearSelection) state.selectedIntents = [];
  $('chatTitle').textContent = 'O que pretende?';
  setComposer('Ou escreva uma pergunta sobre a viatura…');

  const wrap = el('section', 'action-panel');
  wrap.id = 'purposeActions';
  wrap.appendChild(el('div', 'action-heading', 'Pode escolher uma ou várias opções'));

  const grid = el('div', 'quick-actions');
  for (const [intent, icon, label] of ACTIONS) {
    const button = el('button', 'quick');
    button.type = 'button';
    button.dataset.intent = intent;
    button.setAttribute('aria-pressed', state.selectedIntents.includes(intent) ? 'true' : 'false');
    if (state.selectedIntents.includes(intent)) button.classList.add('selected');
    button.innerHTML = `<span class="quick-icon">${icon}</span><span class="quick-label">${label}</span><span class="selection-mark" aria-hidden="true">✓</span>`;
    button.addEventListener('click', () => {
      const index = state.selectedIntents.indexOf(intent);
      if (index >= 0) state.selectedIntents.splice(index, 1);
      else state.selectedIntents.push(intent);
      const selected = state.selectedIntents.includes(intent);
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      updateSelectionControls(wrap);
      save();
    });
    grid.appendChild(button);
  }
  wrap.appendChild(grid);

  const footer = el('div', 'selection-footer');
  footer.appendChild(el('div', 'selection-count', 'Selecione uma ou várias opções'));
  const continueButton = el('button', 'continue-selection', 'Continuar');
  continueButton.type = 'button';
  continueButton.disabled = state.selectedIntents.length === 0;
  continueButton.addEventListener('click', beginSelectedIntents);
  footer.appendChild(continueButton);
  wrap.appendChild(footer);

  $('messages').appendChild(wrap);
  updateSelectionControls(wrap);
  scrollEnd();
  save();
}

function beginSelectedIntents() {
  if (!state.selectedIntents.length) return;
  removeActionPanels();
  state.intentQueue = [...state.selectedIntents];
  const labels = state.selectedIntents.map((item) => INTENTS[item].short).join(', ');
  addBubble(`Pretendo tratar: ${labels}.`, 'user');
  advanceIntent();
}

function advanceIntent() {
  if (!state.intentQueue.length) {
    state.pendingIntent = '';
    $('chatTitle').textContent = 'Pedido preparado';
    renderFollowupActions();
    setComposer('Pode acrescentar uma observação…');
    save();
    return;
  }
  const intent = state.intentQueue.shift();
  const config = INTENTS[intent];
  state.pendingIntent = intent;
  $('chatTitle').textContent = `${config.short} · ${state.intentQueue.length + 1} por tratar`;
  addBubble(config.prompt, 'bot');
  setComposer(config.placeholder);
  save();
}

function intentComplete(intent) {
  if (intent === 'disponibilidade') return Boolean(state.lead.nome && state.lead.telefone);
  if (intent === 'financiamento') return Boolean(state.lead.financiamento);
  if (intent === 'retoma') return Boolean(state.lead.retoma);
  if (intent === 'visita') return Boolean(state.lead.visita);
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
  other.addEventListener('click', () => renderPurposeActions(true));
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
  scrollEnd();
}

async function loadStock() {
  $('chatTitle').textContent = 'Escolha uma viatura';
  setComposer('Pode também escrever o modelo que procura…');
  addBubble('Escolha uma viatura para continuar.', 'bot');
  const status = el('div', 'stock-status', 'A carregar fotografias e dados das viaturas…');
  status.id = 'stockStatus';
  $('messages').appendChild(status);
  scrollEnd();
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
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  state.lead.viatura = item.title;
  $('stockGrid')?.remove();
  $('changeBtn').hidden = false;
  $('chatTitle').textContent = 'Viatura selecionada';
  renderSelected();
  renderSummary();
  addBubble(item.title, 'user');
  addBubble('Boa escolha. Selecione todos os assuntos que pretende tratar.', 'bot');
  renderPurposeActions(true);
}

async function sendMessage(message) {
  const text = String(message || '').trim();
  if (!text) return;
  const currentIntent = state.pendingIntent;
  $('messageInput').value = '';
  $('sendBtn').disabled = true;
  removeActionPanels();
  addBubble(text, 'user');
  showTyping();
  try {
    const cleanHistory = state.history
      .slice(-12, -1)
      .filter((entry) => !/^Pretendo tratar:/i.test(entry.content) && !/^Boa escolha\./i.test(entry.content));
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        intent: currentIntent,
        contexto: { viatura: state.vehicle?.title || state.lead.viatura || '' },
        lead: state.lead,
        history: cleanHistory
      })
    });
    const data = await response.json();
    hideTyping();
    if (!response.ok) throw new Error(data.error || 'Erro');
    if (data.lead) state.lead = { ...state.lead, ...data.lead };
    addBubble(data.reply || 'Obrigado. O Carlos dará seguimento ao seu pedido.', 'bot');
    renderSummary();
    renderSelected();

    if (currentIntent && intentComplete(currentIntent)) {
      state.pendingIntent = '';
      advanceIntent();
    } else if (currentIntent) {
      const config = INTENTS[currentIntent];
      $('chatTitle').textContent = config.short;
      setComposer(config.placeholder);
      save();
    } else {
      renderFollowupActions();
      setComposer('Pode acrescentar uma observação…');
    }
  } catch {
    hideTyping();
    addBubble('Não consegui responder automaticamente neste momento. Pode continuar diretamente com o Carlos pelo WhatsApp.', 'bot');
    renderFollowupActions();
  } finally {
    $('sendBtn').disabled = false;
    save();
  }
}

function enterChat() {
  $('welcome').hidden = true;
  $('chat').classList.add('visible');
  $('messages').textContent = '';
  state.history = [];
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  loadStock();
}

function changeVehicle() {
  state.vehicle = null;
  state.selectedIntents = [];
  state.intentQueue = [];
  state.pendingIntent = '';
  state.lead.viatura = '';
  $('messages').textContent = '';
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  loadStock();
}

function resetAll() {
  clearState();
  $('messages').textContent = '';
  $('chat').classList.remove('visible');
  $('welcome').hidden = false;
  $('changeBtn').hidden = true;
  renderSelected();
  renderSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('startBtn').addEventListener('click', enterChat);
$('changeBtn').addEventListener('click', changeVehicle);
$('resetBtn').addEventListener('click', resetAll);
$('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('messageInput').value);
});

const restored = restore();
renderSelected();
renderSummary();
if (restored) {
  $('welcome').hidden = true;
  $('chat').classList.add('visible');
  $('changeBtn').hidden = !state.vehicle;
  for (const entry of state.history) addBubble(entry.content, entry.role === 'user' ? 'user' : 'bot', false);
  if (!state.history.length) addBubble('Retomámos o seu pedido anterior.', 'bot');
  if (state.vehicle) {
    if (state.pendingIntent) {
      const config = INTENTS[state.pendingIntent];
      $('chatTitle').textContent = config.short;
      setComposer(config.placeholder);
    } else if (state.intentQueue.length) {
      advanceIntent();
    } else {
      renderPurposeActions(false);
    }
  } else {
    loadStock();
  }
}
