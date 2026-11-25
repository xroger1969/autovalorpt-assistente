(() => {
  'use strict';
  const list = document.getElementById('vehicleList');
  const status = document.getElementById('inventoryStatus');
  const checked = document.getElementById('checkedAt');
  const retry = document.getElementById('retryInventory');
  const currency = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const kilometres = new Intl.NumberFormat('pt-PT');
  const when = new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
  let loading = false;

  function safeUrls(item) {
    const advert = new URL(item.url), image = new URL(item.image);
    if (!/^ID[A-Za-z0-9]{5,30}$/.test(item.id) ||
        !['https://standvirtual.com', 'https://www.standvirtual.com'].includes(advert.origin) ||
        !/^\/carros\/anuncio\/[^/?#]+-ID[A-Za-z0-9]+\.html$/.test(advert.pathname) || !advert.pathname.endsWith('-' + item.id + '.html') ||
        advert.username || advert.password || advert.search || advert.hash ||
        image.origin !== 'https://ireland.apollo.olxcdn.com' || image.username || image.password || image.hash ||
        !image.pathname.startsWith('/v1/files/')) throw new Error('invalid_listing');
    return { advert, image };
  }

  function label(tag, name, text) {
    const element = document.createElement(tag);
    element.className = name;
    element.textContent = text;
    return element;
  }

  function vehicleCard(item) {
    const { advert, image } = safeUrls(item);
    if (typeof item.title !== 'string' || !item.title.trim() || !Number.isFinite(item.price) || item.price <= 0 ||
        !Number.isSafeInteger(item.year) || !Number.isSafeInteger(item.mileage) || item.mileage < 0 ||
        !Array.isArray(item.sources) || !item.sources.length || item.sources.some(name => !['Samucar', 'AutoValorPT'].includes(name))) {
      throw new Error('invalid_listing');
    }
    const card = document.createElement('li'); card.className = 'stock-card';
    const frame = document.createElement('div'); frame.className = 'stock-photo';
    const photo = document.createElement('img');
    photo.alt = item.title; photo.loading = 'lazy'; photo.decoding = 'async';
    photo.addEventListener('error', () => frame.replaceChildren(label('small', '', 'Fotografia indisponível')), { once: true });
    photo.src = image.href; frame.append(photo);
    const copy = document.createElement('div'); copy.className = 'stock-copy';
    copy.append(label('p', 'stock-source', item.sources.join(' · ')), label('h2', '', item.title),
      label('p', 'stock-meta', item.year + ' · ' + kilometres.format(item.mileage) + ' km'));
    const bottom = document.createElement('div'); bottom.className = 'stock-bottom';
    const link = label('a', 'stock-link', 'Ver anúncio'); link.href = advert.href;
    link.setAttribute('aria-label', 'Ver anúncio de ' + item.title + ' no Standvirtual');
    const arrow = label('span', 'out-arrow', ''); arrow.setAttribute('aria-hidden', 'true'); link.append(arrow);
    bottom.append(label('p', 'stock-price', currency.format(item.price)), link); copy.append(bottom);
    card.append(frame, copy);
    return card;
  }

  async function loadStock() {
    if (loading) return;
    loading = true; retry.hidden = true; checked.hidden = true; list.replaceChildren();
    list.setAttribute('aria-busy', 'true'); status.textContent = 'A consultar os dois inventários…';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/stock?integration=electric-stock', {
        method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error('stock_unavailable');
      const data = await response.json();
      const date = new Date(data?.checkedAt);
      if (data?.ok !== true || !Array.isArray(data.items) || typeof data.checkedAt !== 'string' || !Number.isFinite(date.getTime())) throw new Error('stock_invalid');
      const cars = [...data.items].sort((a, b) => a.price - b.price || String(a.title).localeCompare(String(b.title), 'pt'));
      list.replaceChildren(...cars.map(vehicleCard));
      status.textContent = cars.length === 0 ? 'De momento, não há elétricos disponíveis nestes inventários.' :
        cars.length === 1 ? '1 viatura disponível' : cars.length + ' viaturas disponíveis';
      checked.dateTime = date.toISOString(); checked.textContent = 'Consultado a ' + when.format(date); checked.hidden = false;
      retry.hidden = cars.length > 0;
    } catch {
      status.textContent = 'Não foi possível confirmar o stock. Tenta novamente.';
      retry.hidden = false;
    } finally {
      clearTimeout(timer); loading = false; list.setAttribute('aria-busy', 'false');
    }
  }
  retry.addEventListener('click', loadStock);
  window.addEventListener('pageshow', event => { if (event.persisted) void loadStock(); });
  void loadStock();
})();
