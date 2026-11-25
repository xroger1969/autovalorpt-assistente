(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { validDay, imageUrl, renderCopyCredit } = globalThis.AutoValorEditorialPreview;
  const api = '/api/stock?integration=editorial&action=';
  const modes = new Set(['publish', 'resume', 'verify']);
  let authenticated = false, onExpiry, refresh, status = null;
  let revision = 0, controller = null, review = null, phase = 'closed';

  function message(value) { $('extraStatus').textContent = value; }
  function available() {
    const c = status?.configuration, auth = status?.authorization;
    return authenticated && status?.extra?.available === true && c?.production !== false && c?.tokenConfigured === true &&
      c.accountConfigured === true && c.validApi === true && c.imagesConfigured === true && !auth?.expired && !auth?.lastError;
  }
  function mode() {
    return status?.extra?.verifyOnly ? 'verify' : status?.extra?.resumable ? 'resume' : 'publish';
  }
  function controls() {
    const open = phase !== 'closed';
    $('extraButton').disabled = !available() || open;
    $('extraButton').textContent = mode() === 'verify' ? 'Verificar publicação extra' : mode() === 'resume' ? 'Continuar publicação extra' : 'Publicar conteúdo extra agora';
    $('extraButton').setAttribute?.('aria-expanded', String(open));
    $('extraReview').hidden = !open; $('extraTitle').hidden = open;
    $('extraBack').disabled = phase === 'sending';
    $('extraConfirm').disabled = !available() || phase !== 'review' || !review?.loaded;
    $('extraConfirm').textContent = review?.mode === 'verify' ? 'Verificar envio anterior' : review?.mode === 'resume' ? 'Continuar publicação no Instagram' : 'Publicar no Instagram';
  }
  function clear() {
    revision++;
    controller?.abort(); controller = null; phase = 'closed'; review = null;
    renderCopyCredit($('extraCopyOrigin'), null);
    $('extraArtwork').replaceChildren(); $('extraReviewTitle').textContent = ''; $('extraReviewCaption').textContent = '';
    controls();
  }
  function defaultMessage() {
    if (!authenticated) return '';
    if (status?.extra?.usedToday) return 'Publicação extra de hoje confirmada. A rotina das 19h00 mantém-se.';
    if (mode() === 'verify') return 'O envio anterior ficou por confirmar. Podes verificar o resultado.';
    if (mode() === 'resume') return 'Existe uma publicação extra em preparação.';
    return available() ? 'Revê a imagem e a legenda antes de confirmar.' : 'A publicação extra está indisponível.';
  }
  function setStatus(data) {
    const oldMode = mode(), oldId = status?.extra?.nextPost?.id;
    status = data;
    if (phase !== 'sending' && phase !== 'closed' &&
        (!available() || oldMode !== mode() || oldId && oldId !== status?.extra?.nextPost?.id)) {
      clear();
      message('O estado da publicação mudou. Volta a consultar o conteúdo extra.');
    } else if (phase === 'closed') message(defaultMessage());
    $('extraTitle').textContent = typeof data?.extra?.nextPost?.title === 'string' ? data.extra.nextPost.title : '';
    controls();
  }
  function setSession(active, expire, reload) {
    authenticated = active; onExpiry = expire; refresh = reload; status = null;
    clear(); message(''); $('extraTitle').textContent = '';
  }
  async function request(action, body) {
    const current = new AbortController(); controller = current;
    const timer = setTimeout(() => current.abort(), body ? 240000 : 90000);
    try {
      const response = await fetch(api + action, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: current.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) throw Object.assign(new Error('editorial_request_failed'), { status: response.status });
      return result;
    } finally { clearTimeout(timer); if (controller === current) controller = null; }
  }
  function artwork(post) {
    if (!post || post.extra !== true || !validDay(post.date) || typeof post.id !== 'string' || !post.id ||
        !/^[a-f0-9]{64}$/.test(post.fingerprint) || typeof post.title !== 'string' || !post.title.trim() ||
        typeof post.caption !== 'string' || !post.caption.trim() || post.format !== 'IMAGE' || post.slideCount !== 1 ||
        !Array.isArray(post.images) || post.images.length !== 1) return null;
    const origin = globalThis.location?.origin || 'https://autovalorpt-assistente.vercel.app';
    try {
      const url = new URL(post.images[0], origin);
      const version = url.searchParams.get('v') || url.searchParams.get('version');
      if (![origin, 'https://autovalorpt-assistente.vercel.app'].includes(url.origin) || url.pathname !== '/api/stock' ||
          url.username || url.password || url.hash || url.searchParams.get('integration') !== 'editorial-image' ||
          url.searchParams.get('date') !== post.date || url.searchParams.get('slide') !== '1' ||
          url.searchParams.get('extra') !== '1' || !['v1', 'v2', 'v3'].includes(version)) return null;
      return imageUrl(post, 0);
    } catch { return null; }
  }
  function display(result) {
    const post = result.post, src = artwork(post);
    if (result.ok !== true || !modes.has(result.mode) || !src) throw new Error('invalid_preview');
    const current = { id: post.id, fingerprint: post.fingerprint, mode: result.mode, loaded: false };
    review = current; phase = 'review';
    renderCopyCredit($('extraCopyOrigin'), post);
    $('extraReviewTitle').textContent = post.title; $('extraReviewCaption').textContent = post.caption;
    const image = document.createElement('img');
    image.className = 'editorial-image'; image.width = 1080; image.height = 1350;
    image.alt = post.altTexts?.[0] || 'Imagem da publicação · ' + post.title;
    image.addEventListener('load', () => {
      if (review !== current || phase !== 'review') return;
      current.loaded = true; controls();
      message(result.mode === 'verify' ? 'Verifica se o Instagram confirmou este envio anterior.' :
        result.mode === 'resume' ? 'Revê o conteúdo e confirma a continuação do envio anterior.' :
        'Se a imagem e a legenda estiverem certas, confirma a publicação em @autovalorpt.');
    });
    image.addEventListener('error', () => {
      if (review !== current || phase !== 'review') return;
      current.loaded = false; controls();
      message('Não foi possível carregar a imagem. Volta atrás e abre a pré-visualização novamente.');
    });
    $('extraArtwork').appendChild(image); message('A carregar a imagem para revisão…'); controls(); image.src = src;
    $('extraReviewTitle').focus?.();
  }
  async function open() {
    if (!available() || phase !== 'closed') return;
    const token = ++revision; phase = 'loading'; controls(); message('A preparar a imagem e a legenda…');
    try {
      const data = await request('extra-preview');
      if (token === revision && authenticated) display(data);
    } catch (error) {
      if (token !== revision) return;
      if (error.status === 401) { onExpiry?.(); return; }
      clear(); message(error.status === 409 ? 'O conteúdo extra mudou ou já não está disponível. Consulta o estado.' :
        'Não foi possível abrir a pré-visualização. Volta a tentar para rever a publicação.');
    }
  }
  function resultMessage(result) {
    switch (result?.status) {
      case 'published': case 'already_published': return 'Publicação extra confirmada pelo Instagram.';
      case 'preparing': return 'Imagem em preparação. Podes continuar o mesmo envio quando estiver disponível.';
      case 'busy': return 'Já existe uma publicação em curso. Consulta o estado antes de continuar.';
      case 'review_required': case 'publish_unknown': case 'unknown': return 'O Instagram ainda não confirmou o envio. Verifica a publicação anterior.';
      case 'authorization_required': return 'A autorização do Instagram precisa de verificação.';
      case 'disabled': case 'paused': return 'A rotina está pausada.';
      case 'failed': return 'Não foi possível concluir a publicação. Consulta o estado.';
      default: return 'O resultado da publicação ficou por confirmar. Consulta o estado antes de repetir.';
    }
  }
  async function confirm() {
    if (phase !== 'review' || !available() || !review?.loaded) return;
    const token = revision, { id, fingerprint } = review;
    phase = 'sending'; controls(); message(review.mode === 'verify' ? 'A verificar o envio anterior…' : 'A aguardar a confirmação do Instagram…');
    let outcome;
    try { outcome = resultMessage(await request('extra-run', { confirmation: { id, fingerprint } })); }
    catch (error) {
      if (token !== revision) return;
      if (error.status === 401) { onExpiry?.(); return; }
      outcome = error.status === 409 || error.status === 400 ? 'Esta confirmação já não é válida. Volta a abrir a pré-visualização para rever o conteúdo atual.' :
        'O pedido ficou sem confirmação. Consulta o estado antes de repetir.';
    }
    if (token !== revision || !authenticated) return;
    try { await refresh?.(); } catch { /* Keep the result reported for this request. */ }
    if (token !== revision || !authenticated) return;
    clear(); message(outcome); $('extraButton').focus?.();
  }
  $('extraButton').addEventListener('click', open);
  $('extraConfirm').addEventListener('click', confirm);
  $('extraBack').addEventListener('click', () => {
    if (phase === 'sending' || phase === 'closed') return;
    clear(); message(defaultMessage()); $('extraButton').focus?.();
  });
  globalThis.AutoValorExtraEditorial = { setSession, setStatus };
})();
