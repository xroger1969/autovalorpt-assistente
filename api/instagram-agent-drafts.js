import { adminRequestAuthorized } from '../lib/admin-security.js';
import { noStoreHeaders } from '../lib/photo-security.js';
import { agentConfiguration, listDrafts } from '../lib/instagram-agent.js';

export default async function handler(req, res) {
  noStoreHeaders(res);
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (!adminRequestAuthorized(req)) return res.status(401).json({ error: 'Acesso privado necessário.' });

  try {
    return res.status(200).json({
      configuration: agentConfiguration(),
      items: await listDrafts()
    });
  } catch (error) {
    console.error('instagram-agent-drafts', error?.message);
    return res.status(500).json({ error: 'Não foi possível abrir os rascunhos.' });
  }
}
