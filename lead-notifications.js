(() => {
  const ENDPOINT = '/api/notify-lead';
  const SENT_KEY_PREFIX = 'autovalorpt-lead-alert:';

  function extractLeadText(anchor) {
    try {
      const url = new URL(anchor.href, location.href);
      if (url.hostname !== 'wa.me') return '';
      return url.searchParams.get('text') || '';
    } catch {
      return '';
    }
  }

  function fingerprint(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function recentlySent(text) {
    try {
      const key = `${SENT_KEY_PREFIX}${fingerprint(text)}`;
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 5 * 60 * 1000) return true;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {}
    return false;
  }

  function sendAlert(text) {
    if (!text.startsWith('Olá Carlos, venho do assistente AutoValorPT.')) return;
    if (recentlySent(text)) return;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({ text })
    }).catch(() => {});
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    const text = extractLeadText(anchor);
    if (text) sendAlert(text);
  }, true);
})();
