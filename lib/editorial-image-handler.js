import { feedEditorialPlan, SIMULATOR_IMAGE_VERSION } from './editorial-simulator.js';
import { ADVICE_IMAGE_VERSION, adviceEditorialPlan } from './editorial-advice-calendar.js';
import { createHash } from 'node:crypto';
import { editorialPlan, extraEditorialPlan, EDITORIAL_VERSION } from './editorial-content.js';
import { ELECTRIC_IMAGE_VERSION, scheduledEditorialPlan } from './electric-editorial-calendar.js';
import { WHATSAPP_IMAGE_VARIANT } from './whatsapp-editorial-card.js';

// Only authored, deterministic educational artwork is public. No arbitrary URL,
// filesystem path, private stock record or user text reaches the renderer.
export function createEditorialImageHandler(options = {}) {
  const planFor = options.planFor || editorialPlan;
  const render = options.render || (async (plan, index, variant, theme) => (await import('./editorial-image.js')).renderEditorialImage(plan, index, variant, theme));
  const version = options.version || EDITORIAL_VERSION;
  const images = new Map();
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const { date, slide = '1', v, extra, variant, theme } = req.query || {};
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        typeof slide !== 'string' || !/^[1-4]$/.test(slide) ||
        (v !== undefined && ![version, ELECTRIC_IMAGE_VERSION, ADVICE_IMAGE_VERSION, SIMULATOR_IMAGE_VERSION].includes(v)) || (extra !== undefined && extra !== '1') ||
        (theme !== undefined && (theme !== 'navy1' || !['v3','v4'].includes(v))) ||
        (variant !== undefined && (variant !== WHATSAPP_IMAGE_VARIANT || !v)) ||
        Object.keys(req.query || {}).some(key => !['integration', 'date', 'slide', 'v', 'extra', 'variant', 'theme'].includes(key))) {
      return res.status(400).json({ ok: false, error: 'invalid_editorial_image' });
    }
    let plan;
    try {
      if (v === SIMULATOR_IMAGE_VERSION) plan = feedEditorialPlan(date, extra === '1');
      else if (v === ADVICE_IMAGE_VERSION) plan = adviceEditorialPlan(date, extra === '1');
      else plan = extra === '1' ? extraEditorialPlan(date) : v === ELECTRIC_IMAGE_VERSION ? scheduledEditorialPlan(date) : planFor(date);
      if ([ELECTRIC_IMAGE_VERSION, ADVICE_IMAGE_VERSION, SIMULATOR_IMAGE_VERSION].includes(v) && plan.version !== v) return res.status(404).json({ ok: false, error: 'editorial_image_not_found' });
    }
    catch { return res.status(404).json({ ok: false, error: 'editorial_image_not_found' }); }
    const index = Number(slide) - 1;
    if (!plan?.slides?.[index] || (variant && plan.format === 'REELS')) return res.status(404).json({ ok: false, error: 'editorial_image_not_found' });
    const key = `${v || version}:${plan.id}:${index}` + (variant ? ':' + variant : '') + (theme ? ':' + theme : '');
    const etag = `"${createHash('sha256').update(key).digest('hex')}"`;
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', v ? 'public, max-age=86400, s-maxage=31536000, immutable' : 'public, max-age=300, s-maxage=3600');
    if (req.headers?.['if-none-match'] === etag) return res.status(304).end();
    if (req.method === 'HEAD') return res.status(200).end();
    try {
      let data = images.get(key);
      if (!data) {
        data = await render(plan, index, variant, theme);
        if (images.size >= 24) images.delete(images.keys().next().value);
        images.set(key, data);
      }
      res.setHeader('Content-Length', String(data.length));
      return res.status(200).end(data);
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ ok: false, error: 'editorial_image_unavailable' });
    }
  };
}

export default createEditorialImageHandler();
