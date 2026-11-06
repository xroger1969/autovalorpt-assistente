import { fetchInstagramImage, verifyInstagramImageQuery } from '../lib/instagram-image.js';

export function createInstagramImageHandler(options = {}) {
  const env = options.env || process.env;
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const source = verifyInstagramImageQuery(req.query, env, (options.now || Date.now)());
    if (!source) return res.status(403).json({ error: 'image_access_invalid' });
    try {
      const image = await fetchInstagramImage(source, options.fetchImpl);
      res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Content-Length', image.length);
      return res.status(200).send(image);
    } catch { return res.status(502).json({ error: 'image_unavailable' }); }
  };
}
export default createInstagramImageHandler();
