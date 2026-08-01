const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';
const EXTERNAL_ID = 'autovalorpt-carlos';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const apiKey = process.env.ONESIGNAL_AUTOVALORPT_API_KEY || process.env.ONESIGNAL_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, error: 'not_configured' });
  const response = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${apiKey}`
    },
    body: JSON.stringify({
      app_id: APP_ID,
      target_channel: 'push',
      include_aliases: { external_id: [EXTERNAL_ID] },
      headings: { en: 'AutoValorPT — integração concluída ✅' },
      contents: { en: 'Teste completo enviado pela Vercel através da nova app OneSignal AutoValorPT.' },
      data: { source: 'autovalorpt', kind: 'smoke_test' },
      url: 'https://autovalorpt-assistente.vercel.app/',
      idempotency_key: 'f33e74b8-8d65-4bda-a8c2-3df37f10c021'
    })
  });
  const data = await response.json().catch(() => ({}));
  return res.status(response.ok ? 200 : 502).json({ ok: response.ok, status: response.status, id: data.id || null });
}
