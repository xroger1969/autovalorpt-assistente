(() => {
  'use strict';
  const date = '2099-01-01';
  const media = '/api/stock?integration=editorial-image&date=2099-01-01&slide=1&v=v4&variant=wa1';
  const api = '/api/stock?integration=whatsapp-status&action=tip-';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const photo = Uint8Array.from(atob(rehearsalJpeg), char => char.charCodeAt(0));
  const sample = { id: 'ensaio-partilha', date, title: 'Imagem de ensaio',
    shareCaption: 'ENSAIO DE PARTILHA · Conteúdo fictício. Cancela antes do envio.',
    altTexts: ['Imagem azul de ensaio, com o aviso «Cancelar antes do envio».'],
    media: [{ url: media, mime: 'image/jpeg' }] };
  let attemptId = null;

  // Only this dedicated page uses these in-memory responses. No fetch is forwarded.
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input, location.origin);
    const method = options.method || 'GET';
    const route = url.pathname + url.search;
    if (url.origin !== location.origin || url.hash) return Response.json({ ok: false }, { status: 404 });
    if (method === 'GET' && route === media) return new Response(photo, { headers: { 'Content-Type': 'image/jpeg' } });
    if (method === 'GET' && route === api + 'list') {
      return Response.json({ ok: true, items: [{ ...sample, status: attemptId ? 'unconfirmed' : 'ready', attemptId }] });
    }
    if (method === 'POST' && [api + 'claim', api + 'release'].includes(route)) {
      let body;
      try { body = JSON.parse(options.body); } catch { return Response.json({ ok: false }, { status: 400 }); }
      if (body?.id !== sample.id) return Response.json({ ok: false }, { status: 400 });
      if (route === api + 'claim' && !attemptId && typeof body.requestId === 'string' && uuid.test(body.requestId)) {
        attemptId = body.requestId;
        return Response.json({ ok: true, status: 'unconfirmed', attemptId });
      }
      if (route === api + 'release' && attemptId && body.attemptId === attemptId && body.notSent === true) {
        const released = attemptId;
        attemptId = null;
        return Response.json({ ok: true, status: 'ready', attemptId: released });
      }
      return Response.json({ ok: false }, { status: 409 });
    }
    return Response.json({ ok: false }, { status: 404 });
  };

  document.addEventListener('DOMContentLoaded', () => AutoValorWhatsappEditorial.setSession(true), { once: true });
})();
