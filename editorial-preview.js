(() => {
  'use strict';
  const productionOrigin = 'https://autovalorpt-assistente.vercel.app';
  const pageOrigin = globalThis.location?.origin || productionOrigin;
  const sourceHosts = new Set([
    'www.acp.pt', 'apclima.pt', 'portugal.gov.pt', 'www.fundoambiental.pt',
    'www.mobie.pt', 'employment-social-affairs.ec.europa.eu'
  ]);
  const dayFormat = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeZone: 'Europe/Lisbon' });

  function validDay(day) {
    const time = Date.parse(day + 'T12:00:00Z');
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day;
  }
  function imageUrl(post, index) {
    if (!post || !validDay(post.date) || !Number.isSafeInteger(index) || index < 0 || index >= 10) return null;
    const query = new URLSearchParams({ integration: 'editorial-image', date: post.date, slide: String(index + 1) });
    let version = post.version, extra = post.extra === true, sourceTheme, hasSource = false;
    const value = (post.imageUrls || post.images)?.[index];
    if (typeof value === 'string') {
      try {
        const source = new URL(value, pageOrigin);
        if ([pageOrigin, productionOrigin].includes(source.origin) && source.pathname === '/api/stock' &&
            !source.username && !source.password && !source.hash && source.searchParams.get('integration') === 'editorial-image') {
          version = source.searchParams.get('v') ?? source.searchParams.get('version') ?? version;
          extra = extra || source.searchParams.get('extra') === '1';
          sourceTheme = source.searchParams.get('theme'); hasSource = true;
        }
      } catch { /* Use the date, slide and version from the preview. */ }
    }
    const theme = hasSource ? sourceTheme : ['v1','v2','v3','v4'].includes(version) &&
      post.date >= (extra ? '2026-11-27' : '2026-11-26') ? 'premium1' : undefined;
    if (theme === 'premium1' && ['v1','v2','v3','v4'].includes(version) || theme === 'navy1' && ['v3','v4'].includes(version))
      query.set('theme', theme);
    else if (theme) return null;
    if (['v1', 'v2', 'v3', 'v4'].includes(version)) query.set('v', version);
    else if (extra) query.set('v', 'v1');
    if (extra) query.set('extra', '1');
    return '/api/stock?' + query;
  }

  function renderSources(sources, panel = document.getElementById('editorialSources'), list = document.getElementById('editorialSourceList')) {
    list.replaceChildren(); panel.hidden = true;
    if (!Array.isArray(sources)) return;
    for (const item of sources) {
      if (!item || typeof item.label !== 'string' || !item.label.trim() || typeof item.url !== 'string') continue;
      let url;
      try { url = new URL(item.url); } catch { continue; }
      if (url.protocol !== 'https:' || !sourceHosts.has(url.hostname) || url.port || url.username || url.password) continue;
      const row = document.createElement('li'), link = document.createElement('a');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = item.label.trim();
      row.appendChild(link);
      if (typeof item.date === 'string' && validDay(item.date)) {
        const date = document.createElement('small');
        date.textContent = ' · ' + dayFormat.format(new Date(item.date + 'T12:00:00Z'));
        row.appendChild(date);
      }
      list.appendChild(row); panel.hidden = false;
    }
  }
  function simulatorLink(id, value, approvedUrl) {
    const link = document.getElementById(id);
    link.hidden = value !== approvedUrl;
    if (link.hidden) link.removeAttribute('href');
    else link.href = approvedUrl;
  }
  function renderSimulatorLinks(post, prefix) {
    simulatorLink(prefix + 'Simulator', post?.simulatorUrl, 'https://carregador.vercel.app/');
    simulatorLink(prefix + 'CreditSimulator', post?.creditSimulatorUrl, 'https://credicarros.vercel.app/simulador-ano.html');
  }
  function appendHistoryCaptions(host, row) {
    if (row?.status !== 'published' || typeof row.caption !== 'string' || !row.caption.trim()) return;
    function section(label, value) {
      const details = document.createElement('details'), summary = document.createElement('summary');
      const caption = document.createElement('p');
      summary.textContent = label;
      caption.className = 'caption history-caption'; caption.textContent = value;
      details.appendChild(summary); details.appendChild(caption); host.appendChild(details);
      return details;
    }
    section('Legenda enviada', row.caption);
    if (typeof row.suggestedCaption !== 'string' || !row.suggestedCaption.trim()) return;
    const suggestion = section('Legenda sugerida para editar no Instagram', row.suggestedCaption);
    const copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'button quiet'; copy.textContent = 'Copiar legenda sugerida';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(row.suggestedCaption); copy.textContent = 'Legenda copiada'; }
      catch { copy.textContent = 'Seleciona o texto acima para copiar'; }
    });
    suggestion.appendChild(copy);
  }
  function copyCredit(post) {
    if (post?.copyOrigin === 'editorial') return 'Legenda da redação AutoValorPT.';
    if (post?.copyOrigin !== 'ai') return '';
    const model = typeof post.copyModel === 'string' && /^(gpt-\d+(?:\.\d+)?|o[134])(?:-(astra|sol|luna|terra|pro|mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/.exec(post.copyModel);
    if (!model) return 'Legenda preparada com inteligência artificial.';
    const name = model[1].replace(/^gpt-/, 'GPT-');
    const variant = { astra: 'Astra', sol: 'Sol', luna: 'Luna', terra: 'Terra', pro: 'Pro', mini: 'mini', nano: 'nano' }[model[2]];
    return 'Legenda preparada com ' + name + (variant ? ' ' + variant : '') + '.';
  }
  function renderCopyCredit(element, post) {
    if (!element) return;
    const value = copyCredit(post);
    element.hidden = !value; element.textContent = value;
  }
  function renderPreviewLinks(post) {
    renderCopyCredit(document.getElementById('editorialCopyOrigin'), post);
    renderSources(post?.sources);
    renderSimulatorLinks(post, 'editorial');
  }
  function videoUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(value, pageOrigin);
      if (![pageOrigin, productionOrigin].includes(url.origin) || url.username || url.password || url.search || url.hash) return null;
      return ['/assets/editorial/rotina-web-v1.mp4', '/assets/editorial/test-drive-web-v1.mp4'].includes(url.pathname) ? url.pathname : null;
    } catch { return null; }
  }
  globalThis.AutoValorEditorialPreview = { validDay, imageUrl, videoUrl, renderSources, renderCopyCredit, renderPreviewLinks, renderSimulatorLinks, appendHistoryCaptions };
})();
