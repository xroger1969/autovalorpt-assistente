(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ID = /^[a-f0-9]{32}$/;
  const CHANNELS = { onesignal: 'Aviso no telemóvel', slack: 'Slack', whatsapp: 'WhatsApp' };
  const STATUS = { new: 'Por contactar', contacted: 'Contactado', closed: 'Fechado' };
  const DELIVERY = {
    pending: 'Pendente', sending: 'A enviar', accepted: 'Aceite pelo serviço', delivered: 'Entregue',
    failed: 'Falhou — pode tentar novamente', unknown: 'Sem confirmação', unconfigured: 'Por configurar',
    not_configured: 'Por configurar', disabled: 'Envio desativado', disabled_preview: 'Desativado nesta revisão'
  };
  let sessionVersion = 0;
  const model = { records: [], cursor: null, selected: null, configuration: {}, listBusy: false, actionBusy: false };

  function node(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function status(target, text = '', kind = '') {
    target.textContent = text;
    target.className = `status${kind ? ` ${kind}` : ''}`;
    target.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function displayDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-PT', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon'
    }).format(date);
  }

  function normalize(value) {
    return String(value || '').toLocaleLowerCase('pt-PT').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function selectedFromUrl() {
    const id = new URLSearchParams(location.search).get('lead') || '';
    return ID.test(id) ? id : '';
  }

  function setUrl(id = '') {
    history.replaceState(null, '', `/leads.html${ID.test(id) ? `?lead=${id}` : ''}`);
  }

  async function api(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(response.status === 401 ? 'A sessão terminou. Volte a entrar.' : response.status === 429 ? 'Demasiadas tentativas. Aguarde um pouco antes de voltar a tentar.' : 'Não foi possível concluir o pedido. Tente novamente.');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A resposta está a demorar. Tente novamente.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function showLogin(message = '', kind = '') {
    sessionVersion += 1;
    model.records = [];
    model.selected = null;
    model.cursor = null;
    model.configuration = {};
    $('leadList').replaceChildren();
    $('detailPanel').replaceChildren();
    $('configurationNotice').replaceChildren();
    $('dashboardView').hidden = true;
    $('privateNav').hidden = true;
    $('loginView').hidden = false;
    $('loginButton').disabled = false;
    status($('loginStatus'), message, kind);
  }

  function showDashboard() {
    $('accessCode').value = '';
    $('loginView').hidden = true;
    $('dashboardView').hidden = false;
    $('privateNav').hidden = false;
  }

  function handleError(error, target = $('dashboardStatus')) {
    if (error.status === 401) { showLogin(error.message); return; }
    status(target, error.message || 'Não foi possível concluir o pedido. Tente novamente.', 'error');
  }

  function renderConfiguration() {
    const box = $('configurationNotice');
    const config = model.configuration || {};
    box.replaceChildren();
    const disabled = config.outboundEnabled === false;
    const whatsappMissing = config.whatsapp && !config.whatsapp.configured;
    box.hidden = !disabled && !whatsappMissing;
    if (disabled) {
      box.appendChild(node('p', '', 'Ambiente de revisão: os avisos externos estão desativados. Os pedidos de teste ficam identificados separadamente.'));
    }
    if (whatsappMissing) {
      const message = node('p');
      message.append(node('strong', '', 'WhatsApp automático por configurar.'), document.createTextNode(' Os pedidos continuam guardados nesta área privada.'));
      box.appendChild(message);
      const missing = Array.isArray(config.whatsapp.missing) ? config.whatsapp.missing.filter((name) => /^[A-Z][A-Z0-9_]{1,80}$/.test(name)) : [];
      if (missing.length) {
        const details = node('details');
        details.appendChild(node('summary', '', 'Ver configuração necessária'));
        const list = node('ul');
        missing.forEach((name) => list.appendChild(node('li', '', name)));
        details.appendChild(list);
        box.appendChild(details);
      }
    }
  }

  function badge(record) { return node('span', `badge ${record.status || 'new'}`, STATUS[record.status] || STATUS.new); }

  function renderList() {
    const term = normalize($('searchInput').value.trim());
    const filter = $('statusFilter').value;
    const visible = model.records.filter((record) => (filter === 'all' || record.status === filter)
      && (!term || normalize([record.name, record.phone, record.vehicle, record.subjects, record.receipt].join(' ')).includes(term)));
    $('newCount').textContent = model.records.filter((record) => record.status === 'new').length;
    $('contactedCount').textContent = model.records.filter((record) => record.status === 'contacted').length;
    $('closedCount').textContent = model.records.filter((record) => record.status === 'closed').length;
    $('listMeta').textContent = `${model.records.length} ${model.records.length === 1 ? 'pedido carregado' : 'pedidos carregados'}${visible.length !== model.records.length ? ` · ${visible.length} na pesquisa` : ''}${model.cursor ? ' · existem mais pedidos' : ''}`;
    const list = $('leadList');
    list.replaceChildren();
    if (!visible.length) list.appendChild(node('div', 'empty', model.records.length
      ? `Nenhum dos pedidos carregados corresponde à pesquisa.${model.cursor ? ' Pode carregar mais pedidos abaixo.' : ''}`
      : 'Ainda não existem pedidos recebidos. Os novos contactos aparecerão aqui.'));
    for (const record of visible) {
      const card = node('button', `lead-card${model.selected?.id === record.id ? ' selected' : ''}`);
      card.type = 'button';
      card.setAttribute('aria-pressed', String(model.selected?.id === record.id));
      const top = node('div', 'card-top');
      top.append(node('h2', 'lead-name', record.name || 'Contacto sem nome'), badge(record));
      card.append(top, node('p', 'lead-vehicle', record.vehicle || 'Pedido geral'), node('p', 'lead-summary', String(record.subjects || record.observations || 'Pedido de contacto').slice(0, 140)));
      const footer = node('div', 'card-footer');
      footer.append(node('span', '', displayDate(record.createdAt)));
      const deliveries = Object.values(record.notifications || {});
      if (deliveries.some((value) => value.status === 'unknown')) footer.appendChild(node('span', 'badge warning', 'Aviso por confirmar'));
      else if (deliveries.some((value) => ['failed', 'pending'].includes(value.status))) footer.appendChild(node('span', '', 'Aviso pendente'));
      if (Number(record.photos?.count)) footer.appendChild(node('span', '', `${record.photos.count} fotografias`));
      card.appendChild(footer);
      card.addEventListener('click', () => openLead(record.id, true));
      list.appendChild(card);
    }
    $('loadMoreButton').hidden = !model.cursor;
    $('loadMoreButton').disabled = model.listBusy;
  }

  async function loadList(reset = true) {
    if (model.listBusy) return;
    model.listBusy = true;
    const version = sessionVersion;
    $('refreshButton').disabled = true;
    $('loadMoreButton').disabled = true;
    status($('dashboardStatus'), 'A carregar pedidos…');
    try {
      const suffix = !reset && model.cursor ? `&cursor=${encodeURIComponent(model.cursor)}` : '';
      const result = await api(`/api/notify-lead?action=list${suffix}`);
      if (version !== sessionVersion) return;
      const incoming = Array.isArray(result.items) ? result.items.filter((record) => ID.test(record.id)) : [];
      const merged = new Map((reset ? [] : model.records).map((record) => [record.id, record]));
      incoming.forEach((record) => merged.set(record.id, record));
      model.records = [...merged.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      model.cursor = typeof result.cursor === 'string' && result.cursor ? result.cursor : null;
      model.configuration = result.configuration || model.configuration;
      renderConfiguration();
      renderList();
      status($('dashboardStatus'));
      const id = model.selected?.id || selectedFromUrl();
      if (id) await openLead(id, false);
      else renderDetail(null);
    } catch (error) { handleError(error); }
    finally { model.listBusy = false; $('refreshButton').disabled = false; $('loadMoreButton').disabled = false; }
  }

  function safeVehicleUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol === 'https:' && (url.hostname === 'standvirtual.com' || url.hostname.endsWith('.standvirtual.com'))) return url.href;
    } catch {}
    return '';
  }

  function deliveryCanRetry(channel, state) {
    return model.configuration.outboundEnabled !== false && model.configuration[channel]?.configured === true
      && ['pending', 'failed', 'unconfigured', 'not_configured'].includes(state?.status || 'pending');
  }

  function actionButton(text, action, className = '') {
    const button = node('button', `button ${className}`, text);
    button.type = 'button';
    button.disabled = model.actionBusy;
    button.addEventListener('click', action);
    return button;
  }

  function renderDetail(record) {
    const detail = $('detailPanel');
    detail.replaceChildren();
    detail.className = `detail${record ? '' : ' placeholder'}`;
    if (!record) { detail.appendChild(node('p', '', 'Escolha um pedido para consultar os dados e dar seguimento.')); return; }
    const back = actionButton('Voltar à lista', () => $('searchInput').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    back.classList.add('detail-back');
    detail.appendChild(back);
    const heading = node('div', 'detail-heading');
    const title = node('h2', '', record.name || 'Contacto sem nome');
    title.id = 'detailTitle';
    detail.setAttribute('aria-labelledby', 'detailTitle');
    heading.append(title, badge(record));
    detail.append(heading, node('p', 'detail-meta', `${record.receipt || `Pedido ${record.id.slice(0, 8).toUpperCase()}`} · ${displayDate(record.createdAt)}`));
    const digits = String(record.phone || '').replace(/\D/g, '');
    if (/^(?:351)?9\d{8}$/.test(digits)) {
      const phone = node('a', 'contact-phone', `Ligar · ${record.phone}`);
      phone.href = `tel:+${digits.length === 9 ? '351' : ''}${digits}`;
      detail.appendChild(phone);
    }
    const fields = node('dl', 'detail-fields');
    const entries = [ ['Viatura', record.vehicle || 'Ainda não escolheu uma viatura'], ['Assuntos', record.subjects],
      ['Pergunta / observações', record.observations], ['Financiamento', record.financing], ['Retoma', record.tradeIn],
      ['Matrícula da retoma', record.registration], ['Visita pretendida', record.visit] ];
    for (const [label, value] of entries) {
      if (!value) continue;
      const row = node('div', 'detail-row');
      row.append(node('dt', '', label), node('dd', '', String(value)));
      fields.appendChild(row);
    }
    detail.appendChild(fields);
    const links = node('div', 'detail-links');
    const vehicleUrl = safeVehicleUrl(record.vehicleUrl);
    if (vehicleUrl) {
      const link = node('a', 'button subtle', 'Ver anúncio da viatura');
      link.href = vehicleUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; links.appendChild(link);
    }
    if (record.photos?.count && ID.test(record.photos.batchId)) {
      const photos = node('a', 'button subtle', `Ver ${record.photos.count} fotografias`);
      photos.href = `/retomas.html?batch=${record.photos.batchId}`;
      links.appendChild(photos);
    }
    if (links.childElementCount) detail.appendChild(links);
    const actions = node('div', 'detail-actions');
    if (record.status !== 'contacted') actions.appendChild(actionButton('Marcar como contactado', () => changeStatus('contacted'), 'primary'));
    if (record.status !== 'closed') actions.appendChild(actionButton('Fechar pedido', () => changeStatus('closed')));
    else actions.appendChild(actionButton('Reabrir pedido', () => changeStatus('new')));
    detail.appendChild(actions);
    const feedback = node('p', 'status'); feedback.id = 'detailStatus'; feedback.setAttribute('aria-live', 'polite'); detail.appendChild(feedback);
    const delivery = node('section', 'delivery');
    delivery.append(node('h3', '', 'Avisos deste pedido'), node('p', 'delivery-intro', 'O pedido está guardado. “Aceite pelo serviço” confirma a aceitação do aviso, sem confirmar a entrega ou a leitura.'));
    const deliveries = node('div', 'delivery-list');
    for (const [channel, label] of Object.entries(CHANNELS)) {
      const value = record.notifications?.[channel] || {status:'pending'};
      const item = node('div', 'delivery-item');
      item.appendChild(node('span', 'delivery-name', label));
      const state = node('span', `delivery-state ${value.status || ''}`, DELIVERY[value.status] || 'Por verificar');
      const detailText = [];
      if (Number(value.attempts)) detailText.push(`${value.attempts} ${value.attempts === 1 ? 'tentativa' : 'tentativas'}`);
      if (value.updatedAt) detailText.push(displayDate(value.updatedAt));
      if (detailText.length) state.appendChild(node('small', '', detailText.join(' · ')));
      item.appendChild(state); deliveries.appendChild(item);
    }
    delivery.appendChild(deliveries);
    const canRetry = Object.keys(CHANNELS).some((channel) => deliveryCanRetry(channel, record.notifications?.[channel]));
    if (canRetry) {
      const retry = node('div', 'retry-row');
      retry.appendChild(actionButton('Tentar novamente os avisos pendentes', () => retryAlerts(false)));
      delivery.appendChild(retry);
    }
    const unknown = Object.keys(CHANNELS).some((channel) => record.notifications?.[channel]?.status === 'unknown'
      && model.configuration[channel]?.configured && model.configuration.outboundEnabled !== false);
    if (unknown) {
      const confirm = node('div', 'unknown-retry');
      confirm.appendChild(node('p', '', 'Um aviso ficou sem confirmação. Verifique o telemóvel ou o canal antes de repetir, pois a primeira tentativa pode ter chegado.'));
      const label = node('label');
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'confirmUnreceived';
      label.append(checkbox, node('span', '', 'Já verifiquei que o aviso não chegou.'));
      const button = actionButton('Repetir os avisos sem confirmação', () => { if (checkbox.checked) retryAlerts(true); });
      button.disabled = true;
      checkbox.addEventListener('change', () => { button.disabled = !checkbox.checked || model.actionBusy; });
      confirm.append(label, button); delivery.appendChild(confirm);
    }
    detail.appendChild(delivery);
  }

  async function openLead(id, scroll = true) {
    if (!ID.test(id) || (model.actionBusy && model.selected?.id !== id)) return;
    const version = sessionVersion;
    const loaded = model.records.find((record) => record.id === id);
    if (loaded) { model.selected = loaded; renderDetail(loaded); renderList(); }
    setUrl(id);
    try {
      const result = await api(`/api/notify-lead?action=get&id=${id}`);
      if (version !== sessionVersion) return;
      if (!result.lead || !ID.test(result.lead.id)) throw new Error('Este pedido não está disponível.');
      if (selectedFromUrl() !== id) return;
      model.selected = result.lead;
      const index = model.records.findIndex((record) => record.id === id);
      if (index >= 0) model.records[index] = result.lead;
      renderDetail(result.lead); renderList();
      if (scroll && window.innerWidth <= 860) $('detailPanel').scrollIntoView({behavior:'smooth',block:'start'});
    } catch (error) { handleError(error); }
  }

  async function runAction(body, successMessage) {
    if (model.actionBusy || !model.selected?.id) return;
    const id = model.selected.id;
    const version = sessionVersion;
    model.actionBusy = true;
    renderDetail(model.selected);
    status($('detailStatus'), 'A guardar…');
    try {
      await api('/api/notify-lead', {method:'POST',body:JSON.stringify({...body,leadId:id})});
      if (version !== sessionVersion) return;
      await openLead(id, false);
      if ($('detailStatus')) status($('detailStatus'), successMessage, 'success');
    } catch (error) { handleError(error, $('detailStatus') || $('dashboardStatus')); }
    finally {
      model.actionBusy = false;
      $('detailPanel').querySelectorAll('button').forEach((button) => { button.disabled = false; });
      if ($('confirmUnreceived')) $('confirmUnreceived').dispatchEvent(new Event('change'));
    }
  }

  function changeStatus(status) { return runAction({action:'status',status}, 'Estado do pedido atualizado.'); }
  function retryAlerts(retryUnconfirmed) { return runAction({action:'retry',retryUnconfirmed}, 'Tentativa concluída. Consulte o estado de cada aviso abaixo.'); }

  $('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const access = $('accessCode').value.trim();
    if (!access) { status($('loginStatus'), 'Indique o código de acesso privado.'); return; }
    $('loginButton').disabled = true;
    status($('loginStatus'), 'A verificar o acesso…');
    try {
      await api('/api/admin-session', {method:'POST',body:JSON.stringify({access})});
      $('accessCode').value = '';
      showDashboard();
      await loadList();
    } catch (error) { status($('loginStatus'), error.status === 401 ? 'Código de acesso inválido.' : error.message, 'error'); }
    finally { $('loginButton').disabled = false; }
  });
  $('logoutButton').addEventListener('click', async () => {
    $('logoutButton').disabled = true;
    try { await api('/api/admin-session', {method:'POST',body:JSON.stringify({action:'logout'})}); showLogin('Sessão terminada.'); }
    catch (error) { handleError(error); }
    finally { $('logoutButton').disabled = false; }
  });
  $('refreshButton').addEventListener('click', () => loadList(true));
  $('loadMoreButton').addEventListener('click', () => loadList(false));
  $('searchInput').addEventListener('input', renderList);
  $('statusFilter').addEventListener('change', renderList);
  window.addEventListener('popstate', () => { const id = selectedFromUrl(); if (id) openLead(id, false); else { model.selected = null; renderDetail(null); renderList(); } });

  // Discard any legacy personal fields in a copied URL; only an opaque record ID is retained.
  const initialId = selectedFromUrl();
  setUrl(initialId);
  api('/api/admin-session').then(async (session) => {
    if (session.authenticated) { showDashboard(); await loadList(); }
    else if (session.configured === false) { showLogin('O acesso privado ainda está a ser configurado.'); $('loginButton').disabled = true; }
    else showLogin();
  }).catch((error) => {
    showLogin(error.data?.configured === false ? 'O acesso privado ainda está a ser configurado.' : error.message, 'error');
    if (error.data?.configured === false) $('loginButton').disabled = true;
  });
})();
