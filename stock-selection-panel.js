(() => {
  'use strict';
  const endpoint = '/api/stock?integration=stock-selection';
  const $ = id => document.getElementById(id);
  const names = { samucar: 'Samucar', autovalorpt: 'AutoValorPT' };
  const numbers = new Intl.NumberFormat('pt-PT');
  let request, expire, refreshDashboard, version = 0, review = null, mode = '', submitting = false, read = null;
  const selected = new Set(), inputs = new Map();
  function element(tag, value, style) {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    if (style) node.className = style;
    return node;
  }
  function url(value, image = false) {
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
      return (image ? u.hostname === 'ireland.apollo.olxcdn.com' && u.pathname.startsWith('/v1/files/') :
        ['standvirtual.com', 'www.standvirtual.com'].includes(u.hostname)) ? u.href : '';
    } catch { return ''; }
  }
  function source(row) { return row.sources.map(key => names[key]).filter(Boolean).join(' e ') || 'Standvirtual'; }
  function description(row) {
    const price = /^(\d+(?:\.\d+)?) EUR$/.exec(row.price);
    return [row.year, Number.isFinite(row.mileage) && numbers.format(row.mileage) + ' km',
      price && numbers.format(Number(price[1])) + ' €', row.id].filter(Boolean).join(' · ');
  }
  function listingLink(row, text) {
    const link = url(row.link);
    const el = element(link ? 'a' : 'span', text);
    if (link) { el.href = link; el.target = '_blank'; el.rel = 'noopener noreferrer'; }
    return el;
  }
  function controls() {
    const pending = review?.pending || [];
    $('stockPickActions').hidden = !pending.length;
    $('stockPickAll').disabled = submitting;
    $('stockPickChoose').disabled = submitting;
    $('stockPickChoose').setAttribute?.('aria-expanded', String(mode === 'choose'));
    $('stockPickBody').hidden = !mode;
    $('stockPickSave').disabled = submitting || !mode;
    $('stockPickSave').textContent = mode === 'all' ? 'Confirmar todas' : selected.size
      ? 'Sincronizar seleção (' + selected.size + ')' : 'Ignorar estes anúncios';
    $('stockPickBack').disabled = submitting;
    for (const [id, entry] of inputs) {
      entry.box.checked = selected.has(id);
      entry.box.disabled = submitting || mode === 'all' || entry.row.alreadyRepresented;
    }
  }
  function edit(nextMode) {
    mode = nextMode; inputs.clear(); selected.clear();
    if (mode === 'all') for (const id of review.defaultIds) selected.add(id);
    const list = $('stockPickRows'); list.replaceChildren();
    if (!mode) { controls(); return; }
    $('stockPickHelp').textContent = mode === 'all'
      ? 'Os anúncios assinalados como possíveis duplicados serão incluídos. Se forem o mesmo carro, toca em «Escolher viaturas» e marca só um.'
      : 'Marca os anúncios que queres incluir. Os que deixares por marcar serão ignorados nas próximas sincronizações.';
    const related = review.related || [], inCatalog = new Set(related.map(row => row.id));
    const allRows = new Map([...related, ...review.pending].map(row => [row.id, row]));
    const groups = new Map();
    for (const row of review.pending) {
      const account = source(row);
      if (!groups.has(account)) {
        const box = element('fieldset', '', 'stock-pick-group');
        box.appendChild(element('legend', account)); groups.set(account, box); list.appendChild(box);
      }
      const entry = element('div', '', 'stock-pick-row'), label = element('label'), box = element('input');
      box.type = 'checkbox'; label.appendChild(box);
      const image = url(row.image, true);
      if (image) {
        const photo = element('img'); photo.src = image; photo.alt = ''; photo.loading = 'lazy';
        photo.width = 66; photo.height = 50; label.appendChild(photo);
      }
      const info = element('span');
      info.appendChild(element('strong', row.title));
      info.appendChild(element('small', description(row)));
      label.appendChild(info); entry.appendChild(label);
      if (url(row.link)) entry.appendChild(listingLink(row, 'Ver anúncio'));
      if (row.alreadyRepresented) entry.appendChild(element('p','Esta viatura já está no catálogo.','hint'));
      for (const [ids, prefix] of [[row.duplicateIds, 'Mesma viatura'], [row.possibleDuplicateIds, 'Possível duplicado']]) {
        for (const id of ids || []) {
          const other = allRows.get(id);
          if (!other || id === row.id) continue;
          const note = element('p', prefix + (inCatalog.has(id) ? ' já no catálogo · ' : ' · '), 'stock-pick-match');
          note.appendChild(listingLink(other, [source(other), other.title, description(other)].join(' · ')));
          entry.appendChild(note);
        }
      }
      groups.get(account).appendChild(entry);
      inputs.set(row.id, { box, row });
      box.addEventListener('change', () => {
        if (mode !== 'choose' || submitting || row.alreadyRepresented) return;
        if (box.checked) {
          for (const id of row.duplicateIds || []) selected.delete(id);
          selected.add(row.id);
        } else selected.delete(row.id);
        controls();
      });
    }
    controls();
  }
  function render(next) {
    if (!next || typeof next.revision !== 'string' || !Array.isArray(next.pending) || !Array.isArray(next.defaultIds)) throw Error('missing_review');
    const previous = review; review = next;
    if (previous?.revision !== next.revision) edit('');
    const n = next.pending.length;
    let summary = n ? (n === 1 ? '1 anúncio novo aguarda' : n + ' anúncios novos aguardam') +
      ' a tua escolha para o catálogo WhatsApp e a app iOS.' : 'Sem anúncios novos por escolher.';
    const included = next.defaultIds.length;
    if (n > included) summary += included ? ' «Sincronizar tudo» inclui ' + included +
      (included === 1 ? ' viatura' : ' viaturas') + ' após retirar duplicados confirmados.' : 'Estas viaturas já constam do catálogo.';
    $('stockPickStatus').textContent = summary;
    controls();
  }
  function setSession(active, api, onExpiry, onDecision) {
    version++; request = active ? api : null; expire = onExpiry; refreshDashboard = onDecision; read = null; submitting = false; review = null;
    edit(''); $('stockPickResult').textContent = ''; $('stockPickStatus').textContent = active ? 'A consultar as duas contas…' : '';
  }
  function refresh() {
    if (!request || submitting) return;
    if (read) return read;
    const current = version;
    read = request(endpoint).then(result => {
      if (current === version) render(result.review);
    }).catch(error => {
      if (current !== version) return;
      if (error.status === 401) { expire(); return; }
      review = null; edit(''); $('stockPickStatus').textContent = 'Não foi possível consultar as duas contas. Volta a tocar em «Verificar tudo».';
    }).finally(() => { if (current === version) read = null; });
    return read;
  }
  function resultText(result) {
    switch (result.whatsapp?.status) {
      case 'catalog_matches': case 'matched': case 'synced': return 'Escolha guardada. O catálogo WhatsApp foi conferido.';
      case 'import_requested': case 'upload_requested': case 'import_pending': case 'upload_pending':
        return 'Escolha guardada. A Meta está a processar a atualização do catálogo WhatsApp.';
      default: return 'Escolha guardada para a app iOS. Consulta o resultado da sincronização em «Catálogo WhatsApp».';
    }
  }
  async function save(decision) {
    if (!request || submitting || !review?.pending.length) return;
    submitting = true; const current = ++version; read = null;
    const body = { revision: review.revision, mode: decision };
    if (decision === 'choose') body.selectedIds = [...selected];
    let outcome;
    controls(); $('stockPickResult').textContent = 'A guardar a escolha…';
    try {
      const result = await request(endpoint, { method: 'POST', body: JSON.stringify(body) }, 290000);
      if (version !== current) return;
      if (!result.ok) throw Error('selection_unconfirmed');
      outcome = resultText(result);
    } catch (error) {
      if (version !== current) return;
      if (error.status === 401) { expire(); return; }
      outcome = error.status === 409 ? 'A lista mudou. Revê os anúncios atuais antes de confirmar.' :
        'O pedido ficou por confirmar. Consulta a lista atualizada antes de repetir.';
    }
    if (version !== current) return;
    review = null; edit(''); submitting = false;
    $('stockPickResult').textContent = outcome;
    await Promise.all([refresh(), refreshDashboard?.()]);
  }
  $('stockPickAll').addEventListener('click', () => {
    if (submitting || !review?.pending.length) return;
    if (review.pending.some(row => row.possibleDuplicateIds?.length)) edit('all');
    else return save('all');
  });
  $('stockPickChoose').addEventListener('click', () => { if (!submitting && review?.pending.length) edit('choose'); });
  $('stockPickBack').addEventListener('click', () => { if (!submitting) edit(''); });
  $('stockPickSave').addEventListener('click', () => { if (mode) return save(mode); });
  function counts() {
    return Number.isSafeInteger(review?.approvedCount) && Number.isSafeInteger(review?.sourceCount) ? review : null;
  }
  globalThis.AutoValorStockSelection = { setSession, refresh, counts };
})();
