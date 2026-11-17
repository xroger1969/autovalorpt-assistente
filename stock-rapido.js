(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = '/api/stock?integration=morning-flow&action=';
  let signedIn = false;
  let updating = false;
  let generation = 0;
  const safeDate = value => {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-PT', {
      timeZone: 'Europe/Lisbon', dateStyle: 'short', timeStyle: 'short'
    }).format(date) : 'Hora por confirmar';
  };
  async function api(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(path, {
        ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
      });
      const value = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error('Pedido indisponível'), {
        status: res.status, code: typeof value.error === 'string' ? value.error : ''
      });
      return value;
    } finally { clearTimeout(timer); }
  }
  function screen(ok, message) {
    signedIn = ok;
    generation++;
    $('loginView').hidden = ok;
    $('privateView').hidden = !ok;
    $('access').value = '';
    $('loginMessage').textContent = message || '';
    if (!ok) {
      $('badge').textContent = 'Por consultar';
      $('currentStatus').textContent = '';
      $('stockInfo').textContent = '';
      $('routineInfo').textContent = '';
      $('runButton').disabled = true;
    }
  }
  function setBadge(message, good = false, warn = false) {
    $('badge').textContent = message;
    $('badge').className = 'badge' + (good ? ' good' : warn ? ' warn' : '');
  }
  function cycleText(data) {
    if (!data) return 'Execução por confirmar.';
    const status = data.status;
    const step = data.step || '';
    const steps = {
      source: 'verificar Standvirtual e folha',
      catalog: 'sincronizar catálogo Meta/WhatsApp',
      retirements: 'verificar retiradas',
      photo: 'publicar fotografia Instagram',
      story: 'criar vídeo e Story Instagram',
      verify: 'confirmar os resultados'
    };
    if (status === 'not_started') return 'Ainda não houve execução extraordinária hoje.';
    if (status === 'queued' || status === 'running')
      return 'Rotina ' + (status === 'queued' ? 'em fila' : 'em curso') + ': ' + (steps[step] || 'a verificar') +
        '. Início: ' + safeDate(data.startedAt) + '.';
    if (status === 'blocked' || status === 'interrupted' || data.stalled)
      return 'A execução precisa de verificação. Não será repetida automaticamente para evitar publicações duplicadas.';
    if (status === 'finished') {
      const results = data.results || {};
      const parts = [];
      if (results.catalog) parts.push('Catálogo: ' + results.catalog.status);
      if (results.photo) parts.push('Fotografias: ' + results.photo.status);
      if (results.story) parts.push('Stories: ' + results.story.status);
      if (results.verify) parts.push('Verificação: ' + results.verify.status);
      return 'Ciclo do servidor terminado em ' + safeDate(data.updatedAt) +
        '. ' + (parts.length ? parts.join(' · ') + '.' : 'Resultados de destino por confirmar.');
    }
    return 'Estado: ' + (status || 'por confirmar') + '.';
  }
  async function refresh() {
    if (!signedIn || updating || document.hidden) return;
    updating = true;
    const version = generation;
    try {
      const results = await Promise.allSettled([
        api(base + 'status&mode=manual'),
        api(base + 'status'),
        api('/api/stock')
      ]);
      if (version !== generation) return;
      if (results.some(value => value.status === 'rejected' && value.reason.status === 401)) {
        screen(false, 'A sessão terminou. Volte a entrar.'); return;
      }
      const manual = results[0].status === 'fulfilled' ? results[0].value : null;
      const regular = results[1].status === 'fulfilled' ? results[1].value : null;
      const stock = results[2].status === 'fulfilled' ? results[2].value : null;
      const state = manual?.status || 'unavailable';
      const available = state === 'not_started';
      $('runButton').disabled = !available;
      setBadge(
        state === 'not_started' ? 'Pronto para atualizar' :
          state === 'finished' ? 'Ciclo extraordinário registado' :
            ['queued', 'running'].includes(state) ? 'Atualização em curso' : 'Por confirmar',
        state === 'not_started',
        state === 'blocked' || state === 'interrupted' || state === 'unavailable'
      );
      $('currentStatus').textContent = results[0].status === 'rejected'
        ? 'Não foi possível verificar o histórico. Não inicie uma nova operação sem confirmação.'
        : cycleText(manual);
      const cars = Array.isArray(stock?.results) ? stock.results : null;
      const latest = cars?.[0];
      $('stockInfo').textContent = cars
        ? cars.length + ' viatura(s) na origem Samucar.' +
          (latest?.title ? ' Primeiro anúncio apresentado: ' + latest.title + ' (' + (latest.price || 'preço por confirmar') + ').' : '')
        : 'Inventário da Samucar por confirmar.';
      $('routineInfo').textContent = results[1].status === 'rejected'
        ? 'A execução habitual das 08h00 não pôde ser consultada.'
        : 'Rotina das 08h00: ' + (regular?.status === 'not_started' ? 'sem execução registada hoje' :
          regular?.status === 'finished' ? 'terminada' :
          regular?.status === 'running' || regular?.status === 'queued' ? 'em curso' :
          regular?.status || 'por confirmar') + '. Agendamento diário mantido.';
    } finally { if (version === generation) updating = false; }
  }
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const access = $('access').value.trim();
    if (!access) return;
    $('loginButton').disabled = true;
    $('loginMessage').textContent = 'A verificar acesso…';
    try {
      await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ access }) });
      screen(true);
      await refresh();
    } catch (e) {
      $('loginMessage').textContent = e.status === 401 ? 'Código inválido.' :
        e.status === 429 ? 'Demasiadas tentativas. Volte a tentar mais tarde.' : 'Não foi possível entrar.';
    } finally { $('loginButton').disabled = false; }
  });
  $('runButton').addEventListener('click', async () => {
    if (!signedIn || updating || $('runButton').disabled) return;
    updating = true;
    $('runButton').disabled = true;
    setBadge('A iniciar…');
    $('currentStatus').textContent = 'A registar a execução extraordinária. Não feche nem repita o pedido.';
    try {
      const data = await api(base + 'manual-start', { method: 'POST' });
      $('currentStatus').textContent = data.status === 'queued'
        ? 'Pedido aceite. As verificações e publicações seguem em segurança. Confirme o resultado no painel.'
        : data.status === 'finished' ? 'A execução extraordinária de hoje já foi concluída. Não será repetida.'
        : 'Pedido registado. Estado: ' + (data.status || 'por confirmar') + '.';
    } catch (e) {
      if (e.status === 401) screen(false, 'Sessão terminada. Volte a entrar.');
      else $('currentStatus').textContent = 'Não foi possível confirmar o início. Consulte o histórico antes de voltar a tentar.';
    } finally {
      updating = false;
      if (signedIn) await refresh();
    }
  });
  $('refreshButton').addEventListener('click', refresh);
  $('logoutButton').addEventListener('click', async () => {
    try { await api('/api/admin-session', { method: 'POST', body: JSON.stringify({ action: 'logout' }) }); }
    catch { /* Close the local view even if the network is unavailable. */ }
    screen(false, 'Sessão terminada.');
  });
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  api('/api/admin-session').then(async data => {
    screen(data.authenticated === true, data.configured === false ? 'O acesso privado ainda não está configurado.' : '');
    if (signedIn) await refresh();
  }).catch(() => screen(false, 'A sessão não pôde ser verificada. Entre com o código privado.'));
})();