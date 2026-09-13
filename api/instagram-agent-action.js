import { adminRequestAuthorized } from '../lib/admin-security.js';
import { noStoreHeaders, readJsonBody, sameOriginRequest } from '../lib/photo-security.js';
import { createExampleDraft, getDraft, publishDraft, saveDraft } from '../lib/instagram-agent.js';

function cleanCaption(value = '') {
  return String(value).replace(/\r\n/g, '\n').trim().slice(0, 2200);
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (!sameOriginRequest(req)) return res.status(403).json({ error: 'Origem não autorizada.' });
  if (!adminRequestAuthorized(req)) return res.status(401).json({ error: 'Acesso privado necessário.' });

  try {
    const body = await readJsonBody(req, 12 * 1024);
    const action = String(body?.action || '').trim();

    if (action === 'seed') {
      return res.status(200).json({ ok: true, item: await createExampleDraft() });
    }

    const sourceId = String(body?.sourceId || '').trim();
    const draft = await getDraft(sourceId);
    if (!draft) return res.status(404).json({ error: 'Rascunho não encontrado.' });

    if (action === 'ignore') {
      const item = await saveDraft({ ...draft, status: 'ignored', ignoredAt: new Date().toISOString() });
      return res.status(200).json({ ok: true, item });
    }

    if (action === 'save') {
      const caption = cleanCaption(body?.caption);
      if (!caption) return res.status(400).json({ error: 'A legenda não pode ficar vazia.' });
      const item = await saveDraft({ ...draft, caption, status: draft.status === 'published' ? 'published' : 'pending' });
      return res.status(200).json({ ok: true, item });
    }

    if (action === 'publish') {
      const caption = cleanCaption(body?.caption || draft.caption);
      if (!caption) return res.status(400).json({ error: 'A legenda não pode ficar vazia.' });
      const published = await publishDraft({ ...draft, caption });
      const item = await saveDraft(published);
      return res.status(200).json({ ok: true, item });
    }

    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (error) {
    console.error('instagram-agent-action', error?.code, error?.message);
    const status = ['meta_not_configured', 'no_media'].includes(error?.code) ? 409 : 500;
    return res.status(status).json({ error: error?.message || 'Não foi possível concluir a ação.', code: error?.code || 'action_failed' });
  }
}
