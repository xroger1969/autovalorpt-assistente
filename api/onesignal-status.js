const APP_ID = '522f4efa-67b0-4a78-8181-6362ee9b3325';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const apiKey = process.env.ONESIGNAL_AUTOVALORPT_API_KEY || process.env.ONESIGNAL_API_KEY;
  if (!apiKey) return res.status(200).json({ configured: false, valid: false });
  try {
    const response = await fetch(`https://api.onesignal.com/apps/${APP_ID}`, {
      headers: { Authorization: `Key ${apiKey}` }
    });
    return res.status(200).json({ configured: true, valid: response.ok, status: response.status });
  } catch {
    return res.status(200).json({ configured: true, valid: false, status: 0 });
  }
}
