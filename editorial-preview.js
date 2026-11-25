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
    let version = post.version, extra = post.extra === true;
    const value = (post.imageUrls || post.images)?.[index];
    if (typeof value === 'string') {
      try {
        const source = new URL(value, pageOrigin);
        if ([pageOrigin, productionOrigin].includes(source.origin) && source.pathname === '/api/stock' &&
            !source.username && !source.password && !source.hash && source.searchParams.get('integration') === 'editorial-image') {
          version = source.searchParams.get('v') ?? source.searchParams.get('version') ?? version;
          extra = extra || source.searchParams.get('extra') === '1';
        }
      } catch { /* Use the date, slide and version from the preview. */ }
    }
    if (extra) { query.set('v', 'v1'); query.set('extra', '1'); }
    else if (version === 'v1' || version === 'v2') query.set('v', version);
    return '/api/stock?' + query;
  }

  function renderSources(sources) {
    const panel = document.getElementById('editorialSources');
    const list = document.getElementById('editorialSourceList');
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
  function renderPreviewLinks(post) {
    renderSources(post?.sources);
    simulatorLink('editorialSimulator', post?.simulatorUrl, 'https://carregador.vercel.app/');
    simulatorLink('editorialCreditSimulator', post?.creditSimulatorUrl, 'https://credicarros.vercel.app/simulador-ano.html');
  }
  globalThis.AutoValorEditorialPreview = { imageUrl, renderPreviewLinks };
})();
