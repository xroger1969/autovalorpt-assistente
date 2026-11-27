(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 5000 ? String(n) : '—';
  let busy = false; let privateAccess = false; let configuration = null; let report = null;
  const labels = {
    catalog_data_matches: ['Dados conferidos na Meta', 'As viaturas, os preços, a disponibilidade, as fotografias e as galerias coincidem com o ficheiro validado.'],
    catalog_matches: ['Stock, preços e imagens confirmados na Meta', 'Foram conferidas as viaturas, a origem, os preços, as imagens, a disponibilidade e os estados de aprovação e publicação. A apresentação no WhatsApp continua por confirmar.'],
    catalog_matches_legacy: ['Stock e preços confirmados na Meta', 'Os dados do catálogo foram confirmados numa verificação anterior. As imagens precisam de uma nova verificação. A apresentação no WhatsApp continua por confirmar.'],
    images_pending: ['Imagens por confirmar na Meta', 'Falta confirmar que a Meta recebeu as fotografias corretas. A rotina acompanha o resultado sem repetir a importação.'],
    images_not_checked: ['Imagens por verificar', 'O resultado anterior ainda não inclui a verificação das imagens. Selecione Verificar agora para conferir o catálogo completo.'],
    matched: ['Catálogo conferido', 'Os artigos encontrados correspondem ao ficheiro validado.'],
    synced: ['Catálogo conferido', 'A importação e os artigos do catálogo foram verificados.'],
    authorization_required: ['Autorização do catálogo pendente', 'A ligação atual ainda não permite consultar e sincronizar este catálogo. As restantes rotinas continuam a funcionar.'],
    catalog_authorization_required: ['Autorização do catálogo pendente', 'Falta uma autorização de servidor válida para este catálogo. Não foi aberta uma sessão de início de sessão.'],
    import_requested: ['Importação pedida', 'A Meta recebeu o pedido. A conclusão e os artigos ainda precisam de confirmação.'],
    import_pending: ['Importação em curso', 'Existe uma importação por concluir. O sistema acompanha o resultado sem criar outro pedido.'],
    upload_pending: ['Importação em curso', 'Existe uma importação por concluir. O sistema acompanha o resultado sem criar outro pedido.'],
    upload_requested: ['Importação pedida', 'O pedido foi enviado à Meta. O resultado permanece por confirmar.'],
    import_unknown: ['Resultado por confirmar', 'O pedido anterior ficou sem confirmação. Uma nova importação permanece bloqueada para evitar repetições.'],
    upload_unknown: ['Resultado por confirmar', 'O pedido anterior ficou sem confirmação. A rotina consulta o estado antes de tentar novamente.'],
    mismatch: ['Diferença encontrada', 'O ficheiro e o catálogo ainda não coincidem. A sincronização depende da validação da origem e do acesso ao catálogo.'],
    catalog_mismatch: ['Diferença encontrada', 'O ficheiro e o catálogo ainda não coincidem.'],
    stock_refresh_required: ['Stock e galerias por atualizar', 'O stock guardado precisa de ser atualizado com as viaturas e fotografias atuais do Standvirtual. Selecione Sincronizar agora para recolher e validar as galerias completas antes de conferir o catálogo.'],
    source_invalid: ['Origem por confirmar', 'Não foi possível ler e validar todas as viaturas ou fotografias do Standvirtual. O último catálogo válido foi preservado. Confirme que os anúncios estão acessíveis e volte a tentar a sincronização.'],
    source_blocked: ['Origem por confirmar', 'A leitura de uma das contas Standvirtual ou do ficheiro não passou na validação. Nenhuma importação foi iniciada.'],
    source_changed: ['Origem alterada durante a leitura', 'O inventário ou o ficheiro mudou durante a verificação. A próxima execução volta a comparar os dados antes de importar.'],
    products_rejected: ['Artigos rejeitados pela Meta', 'A Meta assinalou artigos rejeitados. Repetir a importação não confirma a sua aprovação.'],
    products_pending: ['Artigos ainda por publicar', 'Há artigos com aprovação ou publicação pendente. A contagem no catálogo não confirma a apresentação no WhatsApp.'],
    whatsapp_unconfirmed: ['Fotografias sincronizadas · WhatsApp por confirmar', 'Os artigos estão publicados no catálogo e as fotografias e galerias foram verificadas. A aprovação e a apresentação no WhatsApp continuam por confirmar.'],
    review_required: ['Resultado a rever', 'Os dados devolvidos pela Meta ainda não permitem confirmar ou corrigir o catálogo com segurança. A rotina preservou os artigos existentes.'],
    sync_disabled: ['Correção automática desativada', 'Foi encontrada uma diferença, mas a importação automática ainda não está ativa.'],
    production_required: ['Verificação fora de produção', 'Esta página pode consultar o diagnóstico. As importações são executadas apenas no servidor de produção.'],
    check_failed: ['Verificação por concluir', 'Não foi possível confirmar todos os dados nesta execução. O resultado ficou registado para acompanhamento.'],
    check_deferred: ['Verificação adiada', 'A execução atingiu o tempo reservado para verificar os dados. A próxima execução retoma a verificação.'],
    import_rejected: ['Pedido de importação rejeitado', 'A Meta recusou o pedido de importação. O catálogo não foi anunciado como atualizado.'],
    disabled: ['Correção automática desativada', 'Pode consultar o resultado da verificação. A correção automática ainda não está ativa.'],
    busy: ['Verificação em curso', 'Já existe uma operação em curso. Atualize o estado para consultar o resultado.'],
  };
  const photoLabels = {
    prepared: 'Capas antigas editadas (desativadas)',
    unchanged: 'Mantidas sem alteração',
    pending: 'A aguardar preparação',
    review_required: 'A aguardar revisão',
    failed: 'Fotos de origem indisponíveis',
  };
  function authorizationRequired(r = {}) {
    const auth = r.authorization;
    // Before the source audit succeeds, the server serializes the untested
    // Meta authorization as this neutral value. It is not a denied permission.
    const notChecked = auth == null || auth.ready === false && auth.source === 'none' &&
      auth.catalogManagementGranted == null && !auth.reason;
    return r.permissionRequired === true || /authorization|permission|credential/.test(
      [r.status, r.reason, r.error].filter(value => typeof value === 'string').join(' ')) ||
      Boolean(auth && auth.ready !== true && !notChecked);
  }
  function canSync() {
    // The authenticated action refreshes a stale snapshot before the server
    // evaluates Meta access and every import safeguard. Do not require a
    // successful prior audit to request that recovery.
    return privateAccess && configuration?.enabled === true && !authorizationRequired(report || {});
  }
  function needsStockRefresh(r) {
    return r.status === 'source_invalid' && ['stock_source_changed', 'stock_not_synchronized'].includes(r.reason);
  }
  function vehicleCount(ids) {
    return Array.isArray(ids) && ids.every(id => typeof id === 'string' && /^ID[A-Za-z0-9]{5,30}$/.test(id))
      ? new Set(ids).size : null;
  }
  function publishedWithUnconfirmedWhatsApp(r) {
    return r.status === 'products_pending' && r.imagesVerified === true &&
      vehicleCount(r.notPublishedIds) === 0 && vehicleCount(r.pendingReviewIds) > 0;
  }
  function showPublication(r, dataConfirmed) {
    const status = $('publicationStatus');
    status.hidden = !dataConfirmed;
    status.textContent = '';
    if (!dataConfirmed) return;
    const signals = [
      [vehicleCount(r.pendingReviewIds), 'Aprovação para WhatsApp por confirmar em'],
      [vehicleCount(r.rejectedIds), 'Aprovação para WhatsApp rejeitada em'],
      [vehicleCount(r.notPublishedIds), 'Publicação no catálogo Meta por confirmar em'],
    ];
    const messages = signals.filter(([total]) => total > 0).map(([total, label]) =>
      `${label} ${total} ${total === 1 ? 'artigo' : 'artigos'}.`);
    if (!messages.length) messages.push(r.catalogConfirmed === true
      ? 'A aprovação para WhatsApp e a publicação no catálogo foram confirmadas pela Meta.'
      : 'A aprovação para WhatsApp ou a publicação no catálogo continua por confirmar.');
    messages.push('A apresentação dos artigos no WhatsApp continua por verificar.');
    status.textContent = messages.join(' ');
  }
  function setBusy(value) {
    busy = value;
    $('refreshButton').disabled = value; $('checkButton').disabled = value || !privateAccess;
    $('syncButton').disabled = value || !canSync();
  }
  async function api(action, method = 'GET') {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 280000);
    try {
      const response = await fetch(`/api/stock?integration=meta-catalog&action=${action}`, {
        method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        if (response.status === 401 || response.status === 403) privateAccess = false;
        const error = new Error(response.status === 401 ? 'A consulta privada não está disponível nesta sessão. A rotina agendada continua no servidor.' : 'Não foi possível confirmar o resultado. Atualize o estado antes de repetir uma sincronização.');
        error.status = response.status; throw error;
      }
      privateAccess = true;
      return data;
    } finally { clearTimeout(timer); }
  }
  function showPhotos(r, galleriesVerified) {
    if (galleriesVerified) {
      // These diagnostics cover vehicles from one source, not photo totals.
      // The remote gallery verification is the relevant result in this state.
      $('photoCounts').replaceChildren();
      $('photoStatus').textContent = 'Fotografias principais e galerias das viaturas verificadas na Meta.';
      $('photoNote').textContent = 'O catálogo utiliza exclusivamente fotografias originais do Standvirtual, sem adicionar fundos ou modificar imagens.';
      return;
    }
    const diagnostics = Array.isArray(r.imageDiagnostics) ? r.imageDiagnostics.filter(entry =>
      entry && typeof entry.id === 'string' && /^ID[A-Za-z0-9]{5,30}$/.test(entry.id) && Object.hasOwn(photoLabels, entry.status)) : [];
    const byVehicle = new Map(diagnostics.map(entry => [entry.id, entry.status]));
    const totals = Object.fromEntries(Object.keys(photoLabels).map(status => [status, 0]));
    for (const status of byVehicle.values()) totals[status]++;
    const list = $('photoCounts'); list.replaceChildren();
    for (const [status, label] of Object.entries(photoLabels)) {
      if (!totals[status]) continue;
      const li = document.createElement('li'); li.textContent = `${label}: ${totals[status]}.`; list.appendChild(li);
    }
    $('photoStatus').textContent = byVehicle.size
      ? 'Resultado das fotografias da AutoValorPT nesta verificação.'
      : 'Ainda sem verificação das fotografias originais.';
    $('photoNote').textContent = totals.review_required || totals.failed
      ? 'O catálogo utiliza apenas fotografias originais, sem alterações de fundo. Confirme os elementos pendentes antes de importar.'
      : 'O catálogo utiliza exclusivamente fotografias originais do Standvirtual, sem adicionar fundos ou modificar imagens.';
  }
  function show(data) {
    configuration = data.configuration || configuration;
    report = data.lastResult || data.report || (data.status ? data : null);
    const r = report || {};
    $('sourceCount').textContent = count(r.sourceCount);
    $('feedCount').textContent = count(r.expectedCount);
    $('metaCount').textContent = count(r.actualCount);
    const authRequired = authorizationRequired(r);
    const authorizationBlocked = ['authorization_required', 'catalog_authorization_required'].includes(r.status);
    const active = data.active;
    const pendingImport = active || r.import?.pending === true;
    const canConfirm = !authRequired && !pendingImport && r.import?.unverified !== true;
    const strictMatch = canConfirm && r.status === 'catalog_matches' && r.catalogConfirmed === true;
    const dataConfirmed = canConfirm && r.catalogDataConfirmed === true && r.imagesVerified === true &&
      ['catalog_matches', 'products_pending', 'products_rejected'].includes(r.status);
    const legacyGallery = canConfirm && publishedWithUnconfirmedWhatsApp(r);
    const refreshRequired = needsStockRefresh(r);
    let selected = labels[r.status] || (authRequired ? labels.authorization_required : ['Por confirmar', 'Aguardamos uma verificação concluída do catálogo.']);
    if (pendingImport && !authorizationBlocked) {
      selected = active?.phase === 'unknown' ? labels.import_unknown
        : ['import_requested', 'upload_requested'].includes(r.status) ? labels[r.status] : labels.import_pending;
    } else if (dataConfirmed) selected = labels.catalog_data_matches;
    else if (refreshRequired) selected = labels.stock_refresh_required;
    else if (legacyGallery) selected = labels.whatsapp_unconfirmed;
    else if (r.status === 'catalog_matches') {
      if (authRequired) selected = labels.authorization_required;
      else if (strictMatch) selected = labels[r.imagesVerified === true ? 'catalog_matches' : 'catalog_matches_legacy'];
      else selected = labels[r.imagesVerified === true ? 'review_required' : 'images_not_checked'];
    }
    $('stateBadge').textContent = selected[0];
    $('stateBadge').className = `badge ${dataConfirmed || strictMatch ? 'good' : 'pending'}`;
    $('stateText').textContent = selected[1] + (active && authorizationBlocked
      ? ' Existe uma operação de importação por confirmar.' : active ? ' As contagens são do último diagnóstico.' : '');
    if (!pendingImport && refreshRequired && !canSync()) $('stateText').textContent = configuration?.enabled !== true
      ? 'O stock guardado precisa de ser atualizado com as viaturas e galerias atuais do Standvirtual. A sincronização está desativada na configuração do servidor.'
      : 'O stock guardado precisa de ser atualizado com as viaturas e galerias atuais do Standvirtual. É necessário restabelecer a autorização do catálogo antes de pedir a sincronização.';
    const checked = r.checkedAt || r.at || data.lastCheckedAt;
    const date = new Date(checked || '');
    $('checkedAt').textContent = Number.isFinite(date.getTime()) ? `Última verificação: ${new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Lisbon' }).format(date)}.` : 'Ainda sem verificação registada.';
    const list = $('differences'); list.replaceChildren();
    for (const [key, text] of [['missingIds', 'Viaturas do ficheiro ainda não encontradas no catálogo'], ['extraIds', 'Artigos do catálogo ausentes do ficheiro'], ['priceMismatchIds', 'Artigos com diferença de preço'],
      ['imageMismatchIds', 'Viaturas com uma fotografia diferente na Meta'], ['imageUnverifiedIds', 'Viaturas cuja fotografia não pôde ser verificada'],
      ['imagePendingIds', 'Viaturas com fotografia por confirmar na Meta']]) {
      const values = Array.isArray(r[key]) ? r[key].filter(id => /^ID[A-Za-z0-9]{5,30}$/.test(id)) : [];
      if (values.length) { const li = document.createElement('li'); li.textContent = `${text}: ${values.length}.`; list.appendChild(li); }
    }
    $('differencePanel').hidden = !list.children.length;
    showPublication(r, dataConfirmed);
    showPhotos(r, dataConfirmed || legacyGallery);
    $('accessView').hidden = true; $('dashboard').hidden = false;
    setBusy(busy);
  }
  async function perform(action) {
    if (busy || action !== 'status' && !privateAccess || action === 'run' && !canSync()) return;
    setBusy(true); $('actionStatus').textContent = action === 'status' ? 'A consultar o estado…'
      : action === 'run' ? 'A atualizar as duas contas, verificar as fotos originais e sincronizar o catálogo…'
        : 'A comparar as viaturas, os preços e as imagens do catálogo…';
    try {
      const data = await api(action, action === 'status' ? 'GET' : 'POST');
      const sourceBlocked = action === 'run' && data.status === 'source_invalid';
      // A stock refresh can fail before the catalogue audit is persisted. Keep
      // that current failure visible instead of replacing it with an older
      // successful status. It does not invalidate previously confirmed access.
      show(sourceBlocked && data.authorization === undefined ? { ...data, authorization: report?.authorization } : data);
      $('actionStatus').textContent = sourceBlocked
        ? 'Atualização suspensa. O último catálogo válido foi preservado.'
        : action === 'status' ? '' : 'Resultado registado. Consulte o estado acima.';
      if (action !== 'status' && !sourceBlocked) show(await api('status'));
    } catch (error) {
      const text = error.name === 'AbortError' ? 'O pedido ficou sem resposta e pode continuar em processamento. Atualize o estado antes de repetir.' : error.message;
      $('actionStatus').textContent = text;
      if (error.status === 401 || error.status === 403) { $('dashboard').hidden = true; $('accessView').hidden = false; $('accessStatus').textContent = text; }
    } finally { setBusy(false); }
  }
  $('refreshButton').addEventListener('click', () => perform('status'));
  $('checkButton').addEventListener('click', () => perform('check'));
  $('syncButton').addEventListener('click', () => perform('run'));
  perform('status').then(() => {
    if (!$('accessView').hidden && $('accessStatus').textContent === 'A verificar o acesso existente…') $('accessStatus').textContent = 'Não foi possível consultar o estado privado. A rotina agendada mantém o seu funcionamento no servidor.';
  });
})();
