(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let state = null; let selected = null; let busy = false;
  let nativeTransfer = null;
  const supportsFileShare = () => typeof globalThis.navigator?.canShare === 'function' &&
    typeof globalThis.navigator?.share === 'function' && typeof File === 'function';
  const vehicleCaption = active => [active.title, active.price].filter(Boolean).join(' · ');
  function supportedPayload(file, text) {
    const files = [file];
    for (const payload of text ? [{ files, text }, { files }] : [{ files }]) {
      try { if (navigator.canShare(payload)) return payload; } catch { /* Try the next format. */ }
    }
    return null;
  }
  const format = value => value ? new Date(value).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' }) : '—';
  const errors = {
    status_unauthorized: 'Este acesso terminou ou foi revogado. Entre na área privada para verificar a autorização.',
    status_device_exists: 'Já existe um dispositivo autorizado. Revogue esse acesso antes de autorizar outro.',
    status_attempt_pending: 'Há uma tentativa por concluir. Não volte a enviar o vídeo sem verificar o que aconteceu.',
    status_conflict: 'O estado mudou durante a operação. Atualize a página antes de continuar.',
    status_source_unverified: 'Não foi possível confirmar o stock atual. Nenhum envio foi autorizado.',
    status_candidate_changed: 'O vídeo selecionado mudou. Verifique novamente o stock e o vídeo.',
    status_video_changed: 'O stock ou o vídeo mudou. O envio fica suspenso para revisão.',
    status_video_unavailable: 'O vídeo preparado está indisponível. O envio fica suspenso.',
    status_daily_limit: 'Já foi iniciado um envio hoje. A repetição fica bloqueada, mesmo que o resultado esteja por confirmar.',
    status_file_share_unavailable: 'Este dispositivo não consegue partilhar o MP4 desta forma. Usa «Descarregar vídeo reservado».',
    status_account_unverified: 'Confirme o número +351965637736 na conta WhatsApp antes de continuar.',
    status_observation_required: 'Confirme a conta e descreva o vídeo que viu em «O meu estado».',
    status_attempt_mismatch: 'A tentativa já não pertence a este acesso. Atualize o estado.',
    status_publication_not_started: 'Ainda não foi registado o início desta publicação.',
    status_withdrawal_changed: 'O Estado já não reúne as condições de retirada. Confirme o registo e o stock; não elimine outro Estado.',
    status_removal_observation_required: 'Identifique sem ambiguidades o Estado nesta conta e registe o que observou antes e depois da eliminação.',
    status_removal_not_started: 'Ainda não foi registado o início desta retirada.',
    status_no_live_publications: 'Não há publicações próprias registadas ainda dentro da janela de 24 horas.',
  };
  const endpoint = (action, extra = {}) => `/api/stock?${new URLSearchParams({ integration: 'whatsapp-status', action, ...extra })}`;
  async function api(action, body) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(endpoint(action), { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw Object.assign(new Error(data?.error || 'status_unavailable'), { code: data?.error, status: response.status });
      return data;
    } finally { clearTimeout(timeout); }
  }
  function render(data) {
    if (state?.active?.attemptId !== data.active?.attemptId) {
      nativeTransfer = null;
      $('vehicleCaptionHint').textContent = '';
      $('visible').checked = false; $('observation').value = ''; $('account').value = '';
      for (const id of ['withdrawalVisible', 'withdrawalUnambiguous', 'withdrawalActionObserved', 'withdrawalAbsent']) $(id).checked = false;
      for (const id of ['withdrawalBeforeObservation', 'withdrawalAfterObservation', 'withdrawalAccount']) $(id).value = '';
    }
    state = data; $('private').hidden = false; $('login').hidden = true;
    $('adminControls').hidden = data.role !== 'admin';
    $('enroll').disabled = busy || data.device?.valid || data.blocked;
    $('revoke').disabled = busy || !data.device?.valid;
    $('device').textContent = !data.device ? 'Ainda sem dispositivo autorizado.' : data.device.revokedAt ? `Acesso revogado em ${format(data.device.revokedAt)}.` : !data.device.valid ? 'A autorização expirou ou foi invalidada.' : `${data.device.thisDevice ? 'Este dispositivo está autorizado' : 'Outro dispositivo está autorizado'} até ${format(data.device.expiresAt)}.`;
    $('claim').hidden = !selected || !data.device?.valid || !data.device.thisDevice || data.blocked;
    let nextStep = '';
    if (data.blocked) nextStep = 'Há uma tentativa por concluir. Consulta os dados da tentativa antes de escolher outro vídeo.';
    else if (selected && !data.device?.valid) nextStep = data.role === 'admin'
      ? 'Para reservar o vídeo, abre «Acesso do dispositivo» e autoriza o navegador que vais usar.'
      : 'Para reservar o vídeo, é preciso que o administrador autorize este dispositivo.';
    else if (selected && !data.device?.thisDevice) nextStep = 'Para reservar e descarregar este vídeo, abre esta página no dispositivo autorizado.';
    else if (selected) nextStep = 'Reserva este vídeo para o poderes descarregar.';
    $('candidateHint').textContent = nextStep;
    $('plan').disabled = busy || data.blocked;
    $('withdrawalPlan').disabled = busy || data.blocked;
    const active = data.active; const removing = active?.kind === 'withdrawal';
    $('attempt').hidden = !active || removing; $('attemptDetails').replaceChildren();
    $('withdrawalAttempt').hidden = !removing; $('withdrawalDetails').replaceChildren();
    const ownVideo = Boolean(active && !removing && data.device?.valid && data.device.thisDevice && data.device.id === active.deviceId);
    const caption = ownVideo ? vehicleCaption(active) : '';
    $('vehicleCaption').value = caption;
    $('vehicleCaptionGroup').hidden = !caption;
    if (!ownVideo || active.phase !== 'publishing' || nativeTransfer?.attemptId !== active.attemptId) nativeTransfer = null;
    $('nativePrepare').hidden = !ownVideo || active.phase !== 'reserved' || !supportsFileShare();
    $('nativeShare').hidden = !nativeTransfer;
    $('nativeHint').hidden = $('nativePrepare').hidden && $('nativeShare').hidden;
    if (active && !removing) {
      for (const [label, value] of [['Carro', `${active.title} · ${active.price}`], ['Identificador', active.id], ['Tentativa', active.attemptId], ['Estado', { reserved: 'Vídeo reservado; envio ainda não iniciado', publishing: 'Envio iniciado; publicação por confirmar', unknown: 'Resultado incerto; repetição bloqueada' }[active.phase] || 'Por confirmar'], ['Início', format(active.startedAt)]]) {
        const term = document.createElement('dt'); term.textContent = label; const desc = document.createElement('dd'); desc.textContent = value; $('attemptDetails').append(term, desc);
      }
      const own = data.device?.thisDevice && data.device.id === active.deviceId;
      $('download').hidden = !own || active.phase !== 'reserved';
      if (!$('download').hidden) { $('download').href = endpoint('media', { attempt: active.attemptId }); $('download').download = `AutoValorPT_${active.id}.mp4`; } else $('download').removeAttribute('href');
      $('begin').hidden = !own || active.phase !== 'reserved';
      $('evidence').hidden = !own || !active.publicationStartedAt;
      $('uncertain').hidden = !own || active.phase === 'unknown';
      $('reconcile').hidden = data.role !== 'admin';
    }
    if (removing) {
      const own = data.device?.thisDevice && data.device.id === active.deviceId;
      for (const [label, value] of [['Carro', `${active.title}${active.price ? ` · ${active.price}` : ''}`], ['Publicação original', `${active.id} · observada em ${format(active.observedAt)}`], ['O que foi observado', active.publicationObservation], ['Motivo', active.reason === 'out_of_stock' ? 'Viatura retirada do stock' : 'Dados ou preço alterados'], ['Retirada', { reserved: 'Retirada reservada; identifique o Estado antes de eliminar', deleting: 'Eliminação iniciada; resultado por confirmar', unknown: 'Resultado incerto; não repetir a eliminação' }[active.phase] || 'Por confirmar']]) {
        const term = document.createElement('dt'); term.textContent = label; const desc = document.createElement('dd'); desc.textContent = value; $('withdrawalDetails').append(term, desc);
      }
      $('withdrawalBefore').hidden = !own || active.phase !== 'reserved';
      $('withdrawalAfter').hidden = !own || !active.deletionStartedAt;
      $('withdrawalUncertain').hidden = !own || active.phase === 'unknown';
      $('withdrawalReconcile').hidden = data.role !== 'admin';
    }
    const last = data.lastResult;
    $('last').textContent = last ? last.status === 'observed_published' ? `${last.id}: publicação observada em ${format(last.observedAt)}. ${last.observation}` : `${last.id}: tentativa encerrada sem confirmação de publicação, em ${format(last.at)}. Este carro não será repetido.` : 'Ainda sem publicação observada.';
    const removal = data.lastWithdrawalResult;
    $('lastWithdrawal').textContent = removal ? removal.status === 'observed_removed' ? `${removal.id}: eliminação observada em ${format(removal.observedAt)}. ${removal.observation}` : `${removal.id}: retirada encerrada sem confirmação de eliminação, em ${format(removal.at)}. Não será repetida automaticamente.` : 'Ainda sem eliminação observada.';
    $('automationExplanation').textContent = 'O envio final é feito em «O meu estado» no WhatsApp Business.';
  }
  async function work(action, completed = 'Registo atualizado.') {
    if (busy) return; busy = true;
    for (const button of document.querySelectorAll('button')) button.disabled = true;
    $('message').textContent = 'A verificar…';
    try { await action(); $('message').textContent = completed; }
    catch (error) {
      $('message').textContent = errors[error.code] || 'Não foi possível confirmar a operação. Atualize o estado antes de repetir qualquer envio.';
      if (error.status === 401) { $('private').hidden = true; $('login').hidden = false; state = null; selected = null; nativeTransfer = null; }
    } finally {
      busy = false; for (const button of document.querySelectorAll('button')) button.disabled = false;
      if (state) render(state);
    }
  }
  async function refresh() { selected = null; $('candidate').textContent = 'Verifique o stock para selecionar o próximo vídeo.'; $('withdrawalCandidates').replaceChildren(); $('withdrawalPlanResult').textContent = 'Verifique o stock para identificar Estados que precisem de ser retirados.'; render(await api('status')); }
  $('refresh').onclick = () => work(refresh, 'Registo consultado.');
  for (const action of ['enroll', 'revoke']) $(action).onclick = () => work(async () => { selected = null; render(await api(action, {})); });
  async function loadPlan() {
    const data = await api('plan'); selected = data.candidate;
    const sources = selected?.sourceNames?.join(' e ');
    $('candidate').textContent = selected
      ? [selected.title, selected.price, selected.id, sources].filter(Boolean).join(' · ')
      : errors[data.reason] || (data.pendingVideoCount ? 'Há viaturas novas no stock a aguardar um vídeo disponível para partilhar.' : 'Sem novos vídeos de viaturas disponíveis para o Estado.');
    if (selected && data.pendingCount > 1) $('candidate').textContent += ' · ' + data.pendingCount + ' viaturas por partilhar.';
    $('baseline').textContent = data.wouldInitializeBaseline && selected ? 'Na primeira reserva, os restantes carros atuais ficam excluídos da publicação automática inicial.' : '';
    render(data);
  }
  $('plan').onclick = () => work(loadPlan, 'Pesquisa de vídeo concluída.');
  $('claim').onclick = () => work(async () => { if (!selected) return; const data = await api('claim', { id: selected.id, fingerprint: selected.fingerprint }); selected = null; render(data); });
  const attempt = () => ({ attemptId: state?.active?.attemptId });
  $('copyVehicleCaption').onclick = async () => {
    const active = state?.active;
    const caption = $('vehicleCaption').value;
    if (busy || !active || !caption || $('vehicleCaptionGroup').hidden) return;
    try {
      await navigator.clipboard.writeText(caption);
      if (state?.active?.attemptId === active.attemptId) $('vehicleCaptionHint').textContent = 'Legenda copiada. Podes colá-la no WhatsApp.';
    } catch {
      if (state?.active?.attemptId !== active.attemptId || $('vehicleCaptionGroup').hidden) return;
      $('vehicleCaption').focus();
      $('vehicleCaption').select();
      $('vehicleCaptionHint').textContent = 'Usa a opção «Copiar» do telemóvel para copiar o texto selecionado.';
    }
  };
  $('nativePrepare').onclick = () => work(async () => {
    const active = state?.active;
    if (!active || active.phase !== 'reserved' || !supportsFileShare()) throw { code: 'status_file_share_unavailable' };
    const account = $('account').value.replace(/\s/g, '');
    if (account !== '+351965637736') throw { code: 'status_account_unverified' };
    const response = await fetch(endpoint('media', { attempt: active.attemptId }), {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
    });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'video/mp4')
      throw { code: 'status_video_unavailable', status: response.status };
    const blob = await response.blob();
    const file = new File([blob], 'AutoValorPT_' + active.id + '.mp4', { type: 'video/mp4' });
    const payload = file.size && supportedPayload(file, vehicleCaption(active));
    if (!payload) throw { code: 'status_file_share_unavailable' };
    const result = await api('begin', { attemptId: active.attemptId, account });
    if (result.active?.attemptId !== active.attemptId || result.active.phase !== 'publishing') throw { code: 'status_attempt_mismatch' };
    nativeTransfer = { attemptId: active.attemptId, payload };
    render(result);
  }, 'MP4 pronto. Toca em «Partilhar vídeo no Estado» e escolhe WhatsApp Business.');
  $('nativeShare').onclick = async () => {
    const transfer = nativeTransfer;
    if (busy || !transfer || state?.active?.attemptId !== transfer.attemptId || state.active.phase !== 'publishing') return;
    nativeTransfer = null; $('nativeShare').hidden = true;
    try {
      await navigator.share(transfer.payload);
      if (state?.active?.attemptId !== transfer.attemptId || state?.active?.phase !== 'publishing') return;
      $('message').textContent = 'Verifica «O meu estado» no WhatsApp Business. Regista a publicação só depois de veres o vídeo.';
    } catch {
      if (state?.active?.attemptId !== transfer.attemptId || state?.active?.phase !== 'publishing') return;
      $('message').textContent = 'A partilha terminou sem confirmação. Verifica «O meu estado» antes de voltares a enviar.';
      // Preserve the same file for manual completion when the target is unavailable.
      const file = transfer.payload.files[0];
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = file.name;
      link.textContent = 'Guardar o MP4 já preparado'; $('message').append(document.createElement('br'), link);
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }
  };
  $('begin').onclick = () => work(async () => render(await api('begin', { ...attempt(), account: $('account').value.replace(/\s/g, '') })));
  $('uncertain').onclick = () => work(async () => render(await api('uncertain', attempt())));
  $('close').onclick = () => work(async () => render(await api('close', { ...attempt(), doNotRepeat: true })));
  $('confirm').onclick = () => work(async () => {
    const data = await api('confirm', { ...attempt(), id: state?.active?.id, fingerprint: state?.active?.fingerprint,
      account: $('account').value.replace(/\s/g, ''), observation: $('observation').value.trim(), visibleInMyStatus: $('visible').checked, observationClient: 'whatsapp', observedAt: new Date().toISOString() });
    $('visible').checked = false; $('observation').value = ''; render(data);
  });
  $('withdrawalPlan').onclick = () => work(async () => {
    const data = await api('withdrawal-plan'); render(data); $('withdrawalCandidates').replaceChildren();
    $('withdrawalPlanResult').textContent = data.candidates?.length ? `${data.candidates.length} Estado(s) registado(s) precisam de retirada. Confirme a identidade no WhatsApp antes de eliminar.` : errors[data.reason] || 'O stock conferido não indica Estados próprios que precisem de retirada.';
    $('elapsed').textContent = data.elapsed?.length ? `${data.elapsed.length} publicação(ões) com a janela de 24 horas decorrida. Isto não comprova uma eliminação; não são selecionadas para retirar.` : '';
    for (const item of data.candidates || []) {
      const li = document.createElement('li'); const detail = document.createElement('p');
      detail.textContent = `${item.title}${item.price ? ` · ${item.price}` : ''} · ${item.id} · ${item.reason === 'out_of_stock' ? 'retirado do stock' : 'dados alterados'}. Publicação observada em ${format(item.observedAt)}. ${item.publicationObservation}`;
      li.append(detail);
      if (data.device?.thisDevice && data.device.id === item.deviceId) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Preparar retirada deste Estado';
        button.onclick = () => work(async () => {
          const result = await api('withdrawal-claim', { id: item.id, fingerprint: item.fingerprint, publicationAttemptId: item.publicationAttemptId });
          $('withdrawalCandidates').replaceChildren();
          for (const id of ['withdrawalBeforeObservation', 'withdrawalAfterObservation']) $(id).value = '';
          for (const id of ['withdrawalVisible', 'withdrawalUnambiguous', 'withdrawalActionObserved', 'withdrawalAbsent']) $(id).checked = false;
          render(result);
        }); li.append(button);
      } else { const note = document.createElement('small'); note.textContent = 'Esta retirada só pode ser executada pelo dispositivo que registou a publicação.'; li.append(note); }
      $('withdrawalCandidates').append(li);
    }
  }, 'Consulta de Estados a retirar concluída.');
  const withdrawalIdentity = () => ({ ...attempt(), account: $('withdrawalAccount').value.replace(/\s/g, ''), id: state?.active?.id,
    fingerprint: state?.active?.fingerprint, publicationAttemptId: state?.active?.publicationAttemptId, observedAt: new Date().toISOString() });
  $('withdrawalBegin').onclick = () => work(async () => render(await api('withdrawal-begin', { ...withdrawalIdentity(),
    visibleInMyStatus: $('withdrawalVisible').checked, identityUnambiguous: $('withdrawalUnambiguous').checked, observation: $('withdrawalBeforeObservation').value.trim() })));
  $('withdrawalConfirm').onclick = () => work(async () => render(await api('withdrawal-confirm', { ...withdrawalIdentity(),
    deletionActionObserved: $('withdrawalActionObserved').checked, absentFromMyStatus: $('withdrawalAbsent').checked, observation: $('withdrawalAfterObservation').value.trim() })));
  $('withdrawalUncertain').onclick = () => work(async () => render(await api('uncertain', attempt())));
  $('withdrawalClose').onclick = () => work(async () => render(await api('close', { ...attempt(), doNotRepeat: true })));
  async function openVehiclePlan() {
    try { await loadPlan(); }
    catch (error) {
      if (error.status !== 401) await refresh();
      throw error;
    }
  }
  work(globalThis.location?.hash === '#viaturas-novas' ? openVehiclePlan : refresh, 'Registo consultado.');
})();
