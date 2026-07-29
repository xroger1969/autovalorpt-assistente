const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const loginForm = document.querySelector('#loginForm');
const accessCode = document.querySelector('#accessCode');
const loginButton = document.querySelector('#loginButton');
const loginStatus = document.querySelector('#loginStatus');
const refreshButton = document.querySelector('#refreshButton');
const logoutButton = document.querySelector('#logoutButton');
const searchInput = document.querySelector('#searchInput');
const inbox = document.querySelector('#inbox');
const dashboardStatus = document.querySelector('#dashboardStatus');
const retomaTotal = document.querySelector('#retomaTotal');
const photoTotal = document.querySelector('#photoTotal');
const galleryModal = document.querySelector('#galleryModal');
const galleryTitle = document.querySelector('#galleryTitle');
const gallerySummary = document.querySelector('#gallerySummary');
const gallery = document.querySelector('#gallery');
const galleryStatus = document.querySelector('#galleryStatus');
const closeGallery = document.querySelector('#closeGallery');

let items = [];
let lastFocusedElement = null;

function setStatus(element, message = '', isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function showLogin(message = '', isError = false) {
  dashboardView.hidden = true;
  loginView.hidden = false;
  setStatus(loginStatus, message, isError);
  window.setTimeout(() => accessCode.focus(), 0);
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não disponível';
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function accessFromLocation() {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return fragment.get('access') || query.get('access') || '';
}

function removeAccessFromAddress() {
  if (!window.location.search && !window.location.hash) return;
  window.history.replaceState(null, '', window.location.pathname);
}

async function createSession(code) {
  const response = await fetch('/api/admin-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ access: code })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Código de acesso inválido.');
}

function emptyState(message) {
  const empty = document.createElement('div');
  empty.className = 'empty';

  const icon = document.createElement('span');
  icon.className = 'empty-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '🚘';

  const text = document.createElement('span');
  text.textContent = message;
  empty.append(icon, text);
  return empty;
}

function photoLabel(count) {
  return count === 1 ? '1 fotografia' : `${count} fotografias`;
}

function createRetomaCard(item) {
  const card = document.createElement('article');
  card.className = 'retoma-card';

  const content = document.createElement('div');
  const top = document.createElement('div');
  top.className = 'card-top';

  const vehicle = document.createElement('h2');
  vehicle.className = 'vehicle';
  vehicle.textContent = item.vehicle || 'Viatura pretendida não indicada';

  const date = document.createElement('span');
  date.className = 'date';
  date.textContent = formatDate(item.createdAt);

  const tradeIn = document.createElement('p');
  tradeIn.className = 'trade-in';
  tradeIn.textContent = item.tradeIn || 'Sem descrição da retoma.';

  const count = document.createElement('span');
  count.className = 'photo-count';
  count.textContent = `▣ ${photoLabel(Number(item.photoCount || 0))}`;

  const button = document.createElement('button');
  button.className = 'button primary';
  button.type = 'button';
  button.textContent = item.photoCount ? 'Ver fotografias' : 'Sem fotografias';
  button.disabled = !item.photoCount;
  button.addEventListener('click', () => openGallery(item.batchId, button));

  top.append(vehicle, date);
  content.append(top, tradeIn, count);
  card.append(content, button);
  return card;
}

function renderInbox() {
  inbox.replaceChildren();
  const term = searchInput.value.trim().toLocaleLowerCase('pt-PT');
  const visible = items.filter((item) => {
    const haystack = `${item.vehicle || ''} ${item.tradeIn || ''}`.toLocaleLowerCase('pt-PT');
    return !term || haystack.includes(term);
  });

  if (!visible.length) {
    inbox.append(emptyState(term ? 'Nenhuma retoma corresponde à pesquisa.' : 'Ainda não existem retomas recebidas.'));
    return;
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((item) => fragment.append(createRetomaCard(item)));
  inbox.append(fragment);
}

async function loadInbox({ quiet = false } = {}) {
  refreshButton.disabled = true;
  if (!quiet) setStatus(dashboardStatus, 'A carregar retomas…');

  try {
    const response = await fetch('/api/admin-retomas', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      showLogin('A sessão terminou. Volte a entrar com o código privado.');
      return false;
    }
    if (!response.ok) throw new Error(data.error || 'Não foi possível carregar as retomas.');

    items = Array.isArray(data.items) ? data.items : [];
    retomaTotal.textContent = String(items.length);
    photoTotal.textContent = String(items.reduce((total, item) => total + Number(item.photoCount || 0), 0));
    renderInbox();
    showDashboard();
    setStatus(dashboardStatus, items.length ? `Atualizado às ${new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.` : '');
    return true;
  } catch (error) {
    showDashboard();
    inbox.replaceChildren(emptyState('Não foi possível carregar as retomas.'));
    setStatus(dashboardStatus, error.message, true);
    return false;
  } finally {
    refreshButton.disabled = false;
  }
}

function closeGalleryModal() {
  galleryModal.hidden = true;
  gallery.replaceChildren();
  document.body.style.overflow = '';
  if (lastFocusedElement) lastFocusedElement.focus();
}

async function openGallery(batchId, trigger) {
  lastFocusedElement = trigger;
  galleryModal.hidden = false;
  gallery.replaceChildren();
  galleryTitle.textContent = 'Fotografias da retoma';
  gallerySummary.textContent = '';
  setStatus(galleryStatus, 'A abrir fotografias…');
  document.body.style.overflow = 'hidden';
  closeGallery.focus();

  try {
    const query = new URLSearchParams({ batch: batchId });
    const response = await fetch(`/api/admin-retomas?${query}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      closeGalleryModal();
      showLogin('A sessão terminou. Volte a entrar com o código privado.');
      return;
    }
    if (!response.ok) throw new Error(data.error || 'Não foi possível abrir as fotografias.');

    galleryTitle.textContent = data.vehicle || 'Fotografias da retoma';
    gallerySummary.textContent = `${data.tradeIn || 'Sem descrição da retoma.'} · ${formatDate(data.createdAt)}`;
    const photos = Array.isArray(data.photos) ? data.photos : [];
    if (!photos.length) {
      gallery.append(emptyState('Esta retoma ainda não tem fotografias.'));
    } else {
      const fragment = document.createDocumentFragment();
      photos.forEach((photo, index) => {
        const figure = document.createElement('figure');
        figure.className = 'photo';
        const image = document.createElement('img');
        image.src = photo.url;
        image.alt = `Fotografia ${index + 1} da retoma`;
        image.loading = index > 1 ? 'lazy' : 'eager';
        const caption = document.createElement('figcaption');
        caption.textContent = `Fotografia ${index + 1}`;
        figure.append(image, caption);
        fragment.append(figure);
      });
      gallery.append(fragment);
    }
    setStatus(galleryStatus, '');
  } catch (error) {
    gallery.append(emptyState('Não foi possível abrir as fotografias.'));
    setStatus(galleryStatus, error.message, true);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = accessCode.value.trim();
  loginButton.disabled = true;
  setStatus(loginStatus, 'A confirmar acesso…');
  try {
    await createSession(code);
    accessCode.value = '';
    await loadInbox();
  } catch (error) {
    setStatus(loginStatus, error.message, true);
    accessCode.select();
  } finally {
    loginButton.disabled = false;
  }
});

refreshButton.addEventListener('click', () => loadInbox());
searchInput.addEventListener('input', renderInbox);
closeGallery.addEventListener('click', closeGalleryModal);
galleryModal.addEventListener('click', (event) => {
  if (event.target === galleryModal) closeGalleryModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !galleryModal.hidden) closeGalleryModal();
});
logoutButton.addEventListener('click', async () => {
  await fetch('/api/admin-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'logout' })
  }).catch(() => {});
  items = [];
  showLogin('Sessão terminada.');
});

async function start() {
  const code = accessFromLocation();
  removeAccessFromAddress();

  if (code) {
    try {
      await createSession(code);
    } catch (error) {
      showLogin(error.message, true);
      return;
    }
  }

  await loadInbox({ quiet: true });
}

start();
