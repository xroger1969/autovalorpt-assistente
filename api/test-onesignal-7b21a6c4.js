const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';
const EXTERNAL_ID = 'autovalorpt-carlos';
const TEST_IDEMPOTENCY_KEY = '7b21a6c4-8e51-4f72-a6a5-4f0d12d9c331';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const apiKey = process.env.ONESIGNAL_AUTOVALORPT_API_KEY || process.env.ONESIGNAL_API_KEY;
  if (!apiKey) return res.status(503).json({ ok: false, error: 'onesignal_not_configured' });

  try {
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
        headings: { en: 'AutoValorPT — ligação concluída ✅' },
        contents: { en: 'Teste automático Vercel → OneSignal → iPhone concluído.' },
        data: { source: 'autovalorpt', kind: 'server_integration_test' },
        url: 'https://autovalorpt-assistente.vercel.app/',
        idempotency_key: TEST_IDEMPOTENCY_KEY
      })
    });

    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : 502).json({
      ok: response.ok,
      status: response.status,
      notification_id: data.id || null,
      error: response.ok ? null : 'onesignal_failed'
    });
  } catch {
    return res.status(502).json({ ok: false, error: 'onesignal_unreachable' });
  }
}
