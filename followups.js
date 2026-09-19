const loginPanel = document.getElementById('loginPanel');
const appPanel = document.getElementById('appPanel');
const sessionActions = document.getElementById('sessionActions');
const loginForm = document.getElementById('loginForm');
const accessInput = document.getElementById('accessInput');
const loginError = document.getElementById('loginError');
const leadGrid = document.getElementById('leadGrid');
const dueCount = document.getElementById('dueCount');
const updatedAt = document.getElementById('updatedAt');
const refreshBtn = document.getElementById('refreshBtn');
const logoutBtn = document.getElementById('logoutBtn');

let busy = false;

function setBusy(value) {
  busy = Boolean(value);
  document.body.classList.toggle('busy', busy);
}

function showLogin(message = '') {
  loginPanel.classList.remove('hidden');
  appPanel.classList.add('hidden');
  sessionActions.hidden = true;
  loginError.textContent = message;
}

function showApp() {
  loginPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');
  sessionActions.hidden = false;
  loginError.textContent = '';
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatPhone(raw = '') {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('351') && digits.length === 12) {
    return `+351 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  return digits ? `+${digits}` : '';
}

function whatsappUrl(phone = '', message = '') {
  const digits = String(phone).replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function emptyCard() {
  return `<div class="panel empty"><div class="ok">✅</div><h2>Nada pendente</h2><p class="muted">Não há follow-ups vencidos neste momento.</p></div>`;
}

function cardMarkup(item) {
  const leadId = escapeHtml(item.leadId);
  const name = escapeHtml(item.name || 'Cliente');
  const vehicle = escapeHtml(item.vehicle || 'Viatura');
  const phone = escapeHtml(formatPhone(item.phone));
  const message = escapeHtml(item.message || '');
  const wa = escapeHtml(whatsappUrl(item.phone, item.message));
  const due = escapeHtml(formatDate(item.dueAt));
  const stage = Number(item.stage || 0);

  return `
    <article class="card" data-lead-id="${leadId}" data-stage="${stage}">
      <div class="cardhead">
        <div><h3>${name}</h3><div class="vehicle">${vehicle}</div><div class="phone">📱 ${phone}${due ? ` · devido ${due}` : ''}</div></div>
        <span class="stage">Follow-up ${stage}</span>
      </div>
      <div class="message">${message}</div>
      <div class="row">
        <a class="wa" href="${wa}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>
        <button class="btn soft" type="button" data-action="sent">Já enviei</button>
      </div>
      <div class="row">
        <button class="btn secondary" type="button" data-state="replied">Respondeu</button>
        <button class="btn secondary" type="button" data-state="negotiation">Negociação</button>
        <button class="btn warn" type="button" data-state="closed">Fechado</button>
        <button class="btn danger" type="button" data-state="do_not_contact">Não contactar</button>
      </div>
    </article>`;
}

function render(report) {
  const due = Array.isArray(report.due) ? report.due : [];
  dueCount.textContent = String(due.length);
  updatedAt.textContent = report.evaluatedAt ? `Atualizado ${formatDate(report.evaluatedAt)}` : '';
  leadGrid.innerHTML = due.length ? due.map(cardMarkup).join('') : emptyCard();
}

async function loadFollowUps() {
  if (busy) return;
  setBusy(true);
  try {
    const report = await postJson('/api/notify-lead', { action: 'followup-manual-list' });
    showApp();
    render(report);
  } catch (error) {
    if (error.status === 401 || error.status === 403) showLogin();
    else {
      showApp();
      leadGrid.innerHTML = `<div class="panel"><strong>Não foi possível carregar os follow-ups.</strong><div class="error">${escapeHtml(error.message)}</div></div>`;
    }
  } finally {
    setBusy(false);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  loginError.textContent = '';
  try {
    await postJson('/api/admin-session', { access: accessInput.value.trim() });
    accessInput.value = '';
  } catch (error) {
    loginError.textContent = error.message || 'Código de acesso inválido.';
    setBusy(false);
    return;
  }
  setBusy(false);
  await loadFollowUps();
});

refreshBtn.addEventListener('click', loadFollowUps);

logoutBtn.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try { await postJson('/api/admin-session', { action: 'logout' }); } catch {}
  setBusy(false);
  showLogin();
});

leadGrid.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || busy) return;
  const card = button.closest('[data-lead-id]');
  if (!card) return;
  const leadId = card.dataset.leadId;
  const stage = Number(card.dataset.stage || 0);

  if (button.dataset.action === 'sent') {
    if (!window.confirm('Confirmas que já enviaste esta mensagem no WhatsApp?')) return;
    setBusy(true);
    try {
      await postJson('/api/notify-lead', { action: 'followup-manual-mark-sent', leadId, stage });
    } catch (error) {
      window.alert(error.message || 'Não foi possível registar o envio.');
    } finally { setBusy(false); }
    await loadFollowUps();
    return;
  }

  const state = button.dataset.state;
  if (!state) return;
  if ((state === 'closed' || state === 'do_not_contact') && !window.confirm('Confirmas esta alteração de estado?')) return;
  setBusy(true);
  try {
    await postJson('/api/notify-lead', { action: 'followup-manual-state', leadId, state });
  } catch (error) {
    window.alert(error.message || 'Não foi possível alterar o estado.');
  } finally { setBusy(false); }
  await loadFollowUps();
});

loadFollowUps();
