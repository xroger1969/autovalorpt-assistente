import { adminRequestAuthorized } from '../lib/admin-security.js';
import { noStoreHeaders } from '../lib/photo-security.js';
import { agentConfiguration, syncInstagramSource } from '../lib/instagram-agent.js';

function cronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  return String(req?.headers?.authorization || '') === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Use GET ou POST.' });
  if (!adminRequestAuthorized(req) && !cronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado.' });

  try {
    const result = await syncInstagramSource();
    return res.status(200).json({ ok: true, configuration: agentConfiguration(), ...result });
  } catch (error) {
    console.error('instagram-agent-sync', error?.code, error?.message);
    const status = ['meta_not_configured', 'storage_not_configured'].includes(error?.code) ? 503 : 500;
    return res.status(status).json({
      error: error?.message || 'Falha ao verificar o Instagram.',
      code: error?.code || 'sync_failed',
      configuration: agentConfiguration()
    });
  }
}
