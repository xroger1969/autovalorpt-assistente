import { createCatalogImages } from './catalog-images.js';

// An immutable, approved asset is the only public image input. Neither this
// endpoint nor the CSV endpoint can start image processing or fetch a URL.
export function createCatalogImageHandler(options = {}) {
  const source = options.source || createCatalogImages(options);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const { id, asset } = req.query || {};
    if (typeof id !== 'string' || !/^ID[A-Za-z0-9]{5,30}$/.test(id) ||
        typeof asset !== 'string' || !/^[a-f0-9]{64}$/.test(asset))
      return res.status(400).json({ ok: false, error: 'invalid_catalog_image' });
    try {
      const result = await source.image(id, asset);
      if (!Buffer.isBuffer(result.buffer) || !result.buffer.length || result.mimeType !== 'image/png' || result.hash !== asset)
        throw new Error('invalid image response');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', String(result.buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="${id}.png"`);
      res.setHeader('ETag', `"${asset}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return req.method === 'HEAD' ? res.status(200).end() : res.status(200).send(result.buffer);
    } catch (error) {
      return res.status(error?.code === 'catalog_image_not_found' ? 404 : 503)
        .json({ ok: false, error: 'catalog_image_unavailable' });
    }
  };
}
export default createCatalogImageHandler();
