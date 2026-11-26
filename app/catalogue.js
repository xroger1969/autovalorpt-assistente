import {
  normalizeInventory, fuelCategory, filterVehicles, readFavoriteIds,
  saveFavoriteIds, FAVORITES_KEY, formatPrice, formatMileage, vehicleShareUrl, whatsappUrl,
} from './catalogue-core.js?v=20261126-2';

const $ = id => document.getElementById(id);
const SNAPSHOT_KEY = 'autovalor.catalogue.snapshot.v1';
const API = '/api/stock?integration=catalogue-app';
const REFRESH_MS = 60_000;
const DATE = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon',
});
const state = {
  inventory: null, view: 'stock', favorites: new Set(readFavoriteIds()),
  query: '', fuel: 'all', brand: 'all', maxPrice: null, sort: 'price-asc',
  loading: false, settled: false, confirmed: false, activeId: null, lastAttempt: 0,
};
let installPrompt = null;
let toastTimer;

function safeStorage() { try { return window.localStorage; } catch { return null; } }
function storedInventory() {
  try {
    const raw = safeStorage()?.getItem(SNAPSHOT_KEY);
    return raw ? normalizeInventory(JSON.parse(raw)) : null;
  } catch { return null; }
}
function saveInventory(inventory) {
  try {
    safeStorage()?.setItem(SNAPSHOT_KEY, JSON.stringify({
      ok: true, updatedAt: inventory.updatedAt, revision: inventory.revision,
      total: inventory.items.length, items: inventory.items,
    }));
  } catch { /* Browsing still works if storage is unavailable or full. */ }
}
function toast(message) {
  clearTimeout(toastTimer);
  // A modal is rendered above the document. Keep its feedback in that same
  // layer so copying a link or saving a favourite always has visible feedback.
  (document.querySelector('dialog[open]') || document.body).append($('toast'));
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function setNotice() {
  let message = '';
  if (!navigator.onLine) {
    message = state.inventory
      ? 'Está sem ligação. A mostrar o último catálogo guardado. Confirme a disponibilidade quando voltar a ter Internet.'
      : 'Está sem ligação à Internet. Volte a ligar-se para carregar o catálogo.';
  } else if (!state.confirmed && state.inventory) {
    message = state.loading
      ? 'A confirmar o catálogo. Por enquanto, está a ver a última versão guardada.'
      : 'Não foi possível confirmar o catálogo agora. Está a ver a última versão guardada; tente atualizar novamente.';
  } else if (state.inventory && Date.now() - Date.parse(state.inventory.updatedAt) > 36 * 60 * 60 * 1000) {
    message = 'A última sincronização do stock tem mais de um dia. Confirme os preços e a disponibilidade por WhatsApp.';
  }
  $('connection-notice').textContent = message;
  $('connection-notice').hidden = !message;
}
function updateMetadata(visibleCount) {
  const items = state.inventory?.items || [];
  $('hero-count').textContent = state.inventory ? String(items.length) : '—';
  $('updated-at').textContent = state.inventory ? `Stock de ${DATE.format(new Date(state.inventory.updatedAt))}` : '';
  $('updated-at').title = state.inventory ? `Última sincronização: ${new Date(state.inventory.updatedAt).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })} (Lisboa)` : '';
  if (state.inventory) {
    const noun = visibleCount === 1 ? 'viatura' : 'viaturas';
    $('results-count').textContent = state.view === 'favorites'
      ? `${visibleCount} ${noun} nos seus favoritos`
      : `${visibleCount} ${noun}${visibleCount === items.length ? ' no catálogo' : ` de ${items.length}`}`;
  } else {
    $('results-count').textContent = state.loading || !state.settled ? 'A carregar as viaturas…' : 'Catálogo indisponível';
  }
  $('availability-note').hidden = !items.length;
  const favoriteCount = items.filter(item => state.favorites.has(item.id)).length;
  $('favorite-count').textContent = String(favoriteCount);
  $('favorite-count').hidden = favoriteCount === 0;
  const filters = Number(state.brand !== 'all') + Number(state.maxPrice !== null) + Number(state.sort !== 'price-asc');
  $('filter-count').textContent = String(filters);
  $('filter-count').hidden = filters === 0;
  setNotice();
}
function favoriteState(button, item) {
  const saved = state.favorites.has(item.id);
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', `${saved ? 'Retirar dos' : 'Guardar nos'} favoritos: ${item.title}`);
}
function toggleFavorite(item) {
  if (state.favorites.has(item.id)) state.favorites.delete(item.id);
  else state.favorites.add(item.id);
  const saved = saveFavoriteIds(safeStorage(), state.favorites);
  if (state.view === 'favorites') renderVehicles();
  else {
    document.querySelectorAll('.vehicle-card').forEach(card => {
      if (card.dataset.id === item.id) favoriteState(card.querySelector('.card-favorite'), item);
    });
    updateMetadata(filteredItems().length);
  }
  if (state.activeId === item.id) favoriteState($('detail-favorite'), item);
  if (!saved) toast('Guardado apenas nesta sessão. O navegador não permitiu guardar os favoritos.');
}
function filteredItems() {
  return filterVehicles(state.inventory?.items || [], {
    query: state.query, fuel: state.fuel, brand: state.brand, maxPrice: state.maxPrice,
    sort: state.sort, favoritesOnly: state.view === 'favorites', favoriteIds: state.favorites,
  });
}
function imageFallback(img, placeholder) {
  img.addEventListener('error', () => { img.hidden = true; placeholder.hidden = false; }, { once: true });
}
function renderVehicles() {
  const grid = $('vehicle-grid');
  const items = filteredItems();
  const fragment = document.createDocumentFragment();
  if (!state.inventory && !state.settled) {
    for (let i = 0; i < 3; i += 1) {
      const placeholder = document.createElement('div');
      placeholder.className = 'skeleton-card'; placeholder.setAttribute('aria-hidden', 'true'); fragment.append(placeholder);
    }
  }
  for (const [index, item] of items.entries()) {
    const node = $('vehicle-template').content.cloneNode(true);
    const card = node.querySelector('article');
    card.dataset.id = item.id;
    const img = node.querySelector('.card-image');
    img.src = item.image; img.alt = item.title;
    if (index < 2) img.loading = 'eager';
    imageFallback(img, node.querySelector('.photo-placeholder'));
    const imageButton = node.querySelector('.card-image-button');
    imageButton.setAttribute('aria-label', `Ver ${item.title}`);
    imageButton.addEventListener('click', () => openVehicle(item.id));
    const fuel = node.querySelector('.fuel-badge');
    fuel.textContent = item.fuel || 'Combustível por confirmar';
    fuel.classList.add(fuelCategory(item.fuel));
    const favorite = node.querySelector('.card-favorite');
    favoriteState(favorite, item);
    favorite.addEventListener('click', () => toggleFavorite(item));
    node.querySelector('.card-brand').textContent = item.brand;
    node.querySelector('.card-title').textContent = item.title;
    node.querySelector('.card-year > span').textContent = item.year === null ? 'Ano por confirmar' : String(item.year);
    node.querySelector('.card-mileage > span').textContent = formatMileage(item.mileage);
    node.querySelector('.card-price').textContent = formatPrice(item.price);
    const open = node.querySelector('.card-open');
    open.setAttribute('aria-label', `Ver detalhes de ${item.title}`);
    open.addEventListener('click', () => openVehicle(item.id));
    fragment.append(node);
  }
  grid.replaceChildren(fragment);
  grid.setAttribute('aria-busy', String(state.loading && !state.inventory));
  $('empty-state').hidden = items.length > 0 || !state.inventory && !state.settled;
  if (!$('empty-state').hidden) {
    if (!state.inventory) {
      $('empty-title').textContent = 'Não foi possível carregar o catálogo.';
      $('empty-description').textContent = 'Verifique a ligação e tente novamente. Também pode falar connosco no separador Contacto.';
      $('empty-action').textContent = 'Tentar novamente';
    } else if (state.view === 'favorites' && !state.inventory.items.some(item => state.favorites.has(item.id))) {
      $('empty-title').textContent = 'Os seus favoritos começam aqui.';
      $('empty-description').textContent = 'Toque no coração de uma viatura para a guardar. Só aparecem aqui viaturas que continuam no catálogo.';
      $('empty-action').textContent = 'Explorar viaturas';
    } else if (state.inventory.items.length === 0) {
      $('empty-title').textContent = 'Estamos a preparar novas opções.';
      $('empty-description').textContent = 'Não há viaturas disponíveis no catálogo neste momento. Fale connosco para saber mais.';
      $('empty-action').textContent = 'Contactar AutoValorPT';
    } else {
      $('empty-title').textContent = 'Ainda não encontrámos essa combinação.';
      $('empty-description').textContent = 'Experimente outra pesquisa ou ajuste os filtros para ver mais viaturas.';
      $('empty-action').textContent = 'Limpar filtros';
    }
  }
  updateMetadata(items.length);
}
function updateBrands() {
  const select = $('brand-filter');
  const brands = [...new Set((state.inventory?.items || []).map(item => item.brand))].sort((a, b) => a.localeCompare(b, 'pt-PT'));
  select.replaceChildren(new Option('Todas as marcas', 'all'), ...brands.map(brand => new Option(brand, brand)));
  // Preserve a user's selected brand if it has just left the catalogue, so the
  // empty result explains the situation instead of silently changing a filter.
  if (state.brand !== 'all' && !brands.includes(state.brand)) select.add(new Option(state.brand, state.brand));
  select.value = state.brand;
}
function resetFilters() {
  state.query = ''; state.fuel = 'all'; state.brand = 'all'; state.maxPrice = null; state.sort = 'price-asc';
  $('search').value = ''; $('brand-filter').value = 'all'; $('price-filter').value = ''; $('sort-filter').value = 'price-asc';
  document.querySelectorAll('[data-fuel]').forEach(button => {
    const active = button.dataset.fuel === 'all'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
}
function setView(view, scroll = true) {
  state.view = view;
  $('hero').hidden = view !== 'stock';
  $('catalogue').hidden = view === 'contact';
  $('contact').hidden = view !== 'contact';
  $('catalogue-title').textContent = view === 'favorites' ? 'Os seus favoritos' : 'O nosso stock';
  $('section-kicker').textContent = view === 'favorites' ? 'GUARDADOS POR SI' : 'ENCONTRE A SUA VIATURA';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view; button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  resetFilters(); renderVehicles();
  if (scroll) window.scrollTo({ top: 0, behavior: 'instant' });
}
function showDialog(id) {
  if (!$(id).open) $(id).showModal();
  document.body.classList.add('dialog-open');
}
function closeDialog(id) { $(id).close(); }
function currentVehicle() { return state.inventory?.items.find(item => item.id === state.activeId); }
function fillVehicle(item) {
  $('vehicle-details').hidden = !item;
  $('unavailable-vehicle').hidden = Boolean(item);
  $('detail-actions').hidden = !item;
  $('share-vehicle').hidden = !item;
  $('share-fallback').hidden = true;
  if (!item) {
    $('vehicle-dialog').setAttribute('aria-label', 'Viatura indisponível');
    $('vehicle-dialog').removeAttribute('aria-labelledby');
    return;
  }
  $('vehicle-dialog').removeAttribute('aria-label');
  $('vehicle-dialog').setAttribute('aria-labelledby', 'vehicle-title');
  $('vehicle-title').textContent = item.title;
  $('detail-brand').textContent = item.brand;
  $('detail-price').textContent = formatPrice(item.price);
  const img = $('detail-image');
  img.hidden = false; img.nextElementSibling.hidden = true; img.alt = item.title;
  img.onerror = () => { img.hidden = true; img.nextElementSibling.hidden = false; };
  img.src = item.image;
  const specs = [['Ano', item.year === null ? 'Por confirmar' : item.year], ['Quilómetros', formatMileage(item.mileage)], ['Combustível', item.fuel || 'Por confirmar']];
  $('detail-specs').replaceChildren(...specs.map(([label, value]) => {
    const group = document.createElement('div'); const dt = document.createElement('dt'); const dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = String(value); group.append(dt, dd); return group;
  }));
  favoriteState($('detail-favorite'), item);
  $('detail-source').href = item.url;
  $('detail-whatsapp').href = whatsappUrl(item, window.location.origin);
  $('detail-note').textContent = state.confirmed && navigator.onLine
    ? 'Consulte o anúncio original para ver mais fotografias e todos os detalhes.'
    : 'Está a ver uma versão guardada. Confirme o preço e a disponibilidade quando tiver ligação.';
}
function openVehicle(id, changeUrl = true) {
  state.activeId = id;
  fillVehicle(currentVehicle());
  if (changeUrl) history.pushState({ catalogueVehicle: id }, '', vehicleShareUrl(id, window.location.origin));
  showDialog('vehicle-dialog');
  $('vehicle-dialog').scrollTop = 0;
}
function openRequestedVehicle() {
  const id = new URL(window.location.href).searchParams.get('viatura');
  if (id && /^ID[A-Za-z0-9]{5,30}$/.test(id) && state.inventory && !state.activeId) openVehicle(id, false);
}
async function refreshInventory(manual = false) {
  if (state.loading) return;
  state.loading = true; state.lastAttempt = Date.now();
  $('refresh').disabled = true; $('refresh').classList.add('is-loading'); setNotice();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(API, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('catalogue_unavailable');
    const next = normalizeInventory(await response.json());
    const changed = state.inventory?.revision !== next.revision;
    state.inventory = next; state.confirmed = true; saveInventory(next);
    if (changed) { updateBrands(); renderVehicles(); }
    else updateMetadata(filteredItems().length);
    if (state.activeId) fillVehicle(currentVehicle());
    openRequestedVehicle();
    if (manual) toast(changed ? 'Catálogo atualizado.' : 'Está a ver a última versão do catálogo.');
  } catch {
    state.confirmed = false;
    if (manual) toast(state.inventory ? 'Não foi possível atualizar. Mantivemos o último catálogo.' : 'Não foi possível carregar. Tente novamente.');
  } finally {
    clearTimeout(timeout); state.loading = false; state.settled = true;
    $('refresh').disabled = false; $('refresh').classList.remove('is-loading');
    if (!state.inventory) renderVehicles(); else { $('vehicle-grid').setAttribute('aria-busy', 'false'); updateMetadata(filteredItems().length); }
    if (state.activeId) fillVehicle(currentVehicle());
  }
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('contact-stock').addEventListener('click', () => setView('stock'));
$('contact-whatsapp').href = whatsappUrl(null, window.location.origin);
$('search').addEventListener('input', event => { state.query = event.target.value; renderVehicles(); });
document.querySelectorAll('[data-fuel]').forEach(button => button.addEventListener('click', () => {
  state.fuel = button.dataset.fuel;
  document.querySelectorAll('[data-fuel]').forEach(chip => {
    const active = chip === button; chip.classList.toggle('active', active); chip.setAttribute('aria-pressed', String(active));
  });
  renderVehicles();
}));
$('open-filters').addEventListener('click', () => {
  updateBrands(); $('price-filter').value = state.maxPrice ?? ''; $('sort-filter').value = state.sort; showDialog('filter-dialog');
});
$('filter-form').addEventListener('submit', event => {
  event.preventDefault(); state.brand = $('brand-filter').value;
  state.maxPrice = $('price-filter').value ? Number($('price-filter').value) : null;
  state.sort = $('sort-filter').value; closeDialog('filter-dialog'); renderVehicles();
});
$('reset-filters').addEventListener('click', () => { resetFilters(); renderVehicles(); closeDialog('filter-dialog'); });
$('empty-action').addEventListener('click', () => {
  if (!state.inventory) { void refreshInventory(true); return; }
  if (!state.inventory.items.length) { setView('contact'); return; }
  if (state.view === 'favorites' && !state.inventory.items.some(item => state.favorites.has(item.id))) setView('stock');
  else { resetFilters(); renderVehicles(); }
});
$('refresh').addEventListener('click', () => { void refreshInventory(true); });
$('detail-favorite').addEventListener('click', () => { const item = currentVehicle(); if (item) toggleFavorite(item); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
    if (dialog.id === 'vehicle-dialog') {
      state.activeId = null;
      const url = new URL(window.location.href);
      if (url.searchParams.has('viatura')) {
        if (history.state?.catalogueVehicle === url.searchParams.get('viatura')) history.back();
        else { url.searchParams.delete('viatura'); history.replaceState(null, '', url); }
      }
    }
  });
});
window.addEventListener('popstate', () => {
  const id = new URL(window.location.href).searchParams.get('viatura');
  if (id && /^ID[A-Za-z0-9]{5,30}$/.test(id) && state.inventory) openVehicle(id, false);
  else if ($('vehicle-dialog').open) closeDialog('vehicle-dialog');
});
$('share-vehicle').addEventListener('click', async () => {
  const item = currentVehicle(); if (!item) return;
  const url = vehicleShareUrl(item.id, window.location.origin);
  if (navigator.share) {
    try { await navigator.share({ title: `${item.title} · AutoValorPT`, text: `${item.title} — ${formatPrice(item.price)}`, url }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Ligação da viatura copiada.'); }
  catch { $('share-fallback').hidden = false; $('share-url').value = url; $('share-url').focus(); $('share-url').select(); }
});

function installed() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; }
function updateInstallUi() {
  const hidden = installed();
  document.querySelectorAll('.install-trigger').forEach(button => { button.hidden = hidden; });
  $('install-card').hidden = hidden;
  $('native-install').hidden = !installPrompt;
}
async function promptInstall() {
  if (!installPrompt) { showDialog('install-dialog'); return; }
  const prompt = installPrompt; installPrompt = null;
  try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted' && $('install-dialog').open) closeDialog('install-dialog'); }
  catch { showDialog('install-dialog'); }
  updateInstallUi();
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; updateInstallUi(); });
window.addEventListener('appinstalled', () => { installPrompt = null; document.querySelectorAll('.install-trigger').forEach(button => { button.hidden = true; }); $('install-card').hidden = true; if ($('install-dialog').open) closeDialog('install-dialog'); });
document.querySelectorAll('.install-trigger').forEach(button => button.addEventListener('click', () => { void promptInstall(); }));
$('native-install').addEventListener('click', () => { void promptInstall(); });
if (/iPhone|iPad|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) $('install-other').hidden = true;
updateInstallUi();
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/', updateViaCache: 'none' }).catch(() => {});
  });
}
window.addEventListener('online', () => { void refreshInventory(); });
window.addEventListener('offline', () => { state.confirmed = false; setNotice(); if (state.activeId) fillVehicle(currentVehicle()); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - state.lastAttempt > 15_000) void refreshInventory();
});
window.addEventListener('storage', event => {
  if (event.key === FAVORITES_KEY) { state.favorites = new Set(readFavoriteIds()); renderVehicles(); if (state.activeId) fillVehicle(currentVehicle()); }
});
setInterval(() => { if (!document.hidden && navigator.onLine && state.view !== 'contact') void refreshInventory(); }, REFRESH_MS);
state.inventory = storedInventory();
updateBrands(); renderVehicles(); openRequestedVehicle();
void refreshInventory();
