import { noStoreHeaders } from '../lib/photo-security.js';
import { resolveMediaUrl } from '../lib/instagram-agent.js';

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') return res.status(405).end('Use GET.');

  try {
    const sourceId = String(req.query?.sourceId || '');
    const position = Number(req.query?.position);
    const url = await resolveMediaUrl(sourceId, position);
    if (!url) return res.status(404).end('Imagem não encontrada.');
    res.statusCode = 302;
    res.setHeader('Location', url);
    return res.end();
  } catch (error) {
    console.error('instagram-agent-media', error?.message);
    return res.status(500).end('Não foi possível abrir a imagem.');
  }
}
