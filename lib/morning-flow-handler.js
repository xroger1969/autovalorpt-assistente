import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, sameOriginRequest } from './photo-security.js';
import { createMorningFlow } from './morning-flow.js';

async function productionServices() {
  const [source, catalog, publisher, retirements, stories] = await Promise.all([
    import('./meta-catalog-source.js'), import('./meta-catalog.js'), import('./instagram-publisher.js'),
    import('./instagram-retirements.js'), import('./instagram-stories.js')]);
  return { source: source.createMetaCatalogSource(), catalog: catalog.createMetaCatalog(), photo: publisher.createInstagramPublisher(),
    retirements: retirements.createInstagramRetirements(), story: stories.createInstagramStories({ runBudgetMs: 240000 }) };
}

export function createMorningFlowHandler(options = {}) {
  const env = options.env || process.env;
  const background = options.waitUntil || waitUntil;
  const isAdmin = options.authorizeAdmin || (req => adminRequestAuthorized(req, env));
  const report = options.report || (entry => console.error('morning_flow_failed', JSON.stringify(entry)));
  const flowFor = (services, mode = 'scheduled') => options.flow || createMorningFlow({ ...options, env, services, mode });
  const schedule = work => background(work.catch(error => report({ status: 'review_required',
    reason: /^[a-z_]{1,70}$/.test(error?.code || '') ? error.code : 'morning_step_interrupted' })));
  return async (req, res) => {
    noStoreHeaders(res); res.setHeader('Referrer-Policy', 'no-referrer');
    const expected = Buffer.from(String(env.CRON_SECRET || ''));
    const supplied = Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer /, ''));
    const cron = expected.length >= 32 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
    const action = String(req.query?.action || 'status');
    const mode = action === 'manual-start' ? 'manual' : String(req.query?.mode || 'scheduled');
    if (!cron && !isAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    if (!['status', 'start', 'manual-start', 'continue', 'delay'].includes(action) ||
        !['scheduled', 'manual'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_action' });
    if (['continue', 'delay'].includes(action) && (!cron || req.method !== 'POST')) return res.status(403).json({ ok: false, error: 'server_callback_required' });
    if (action === 'start' && mode !== 'scheduled') return res.status(403).json({ ok: false, error: 'server_callback_required' });
    if (action === 'start' && !cron && (req.method !== 'POST' || !sameOriginRequest(req))) return res.status(403).json({ ok: false, error: 'admin_post_required' });
    if (action === 'manual-start' && (!isAdmin(req) || req.method !== 'POST' || !req.headers?.origin || !sameOriginRequest(req)))
      return res.status(403).json({ ok: false, error: 'admin_post_required' });
    try {
      const flow = flowFor(undefined, mode);
      if (action === 'status') return res.status(200).json(await flow.status(req.query?.day));
      if (action === 'start' || action === 'manual-start') {
        const result = await flow.start();
        if (result.delivery) schedule(flow.deliver(result.delivery.day, result.delivery.ticket));
        return res.status(result.delivery ? 202 : 200).json({ ...result, delivery: undefined });
      }
      const { day, ticket } = req.query || {};
      if (action === 'delay') { schedule(flow.delay(day, ticket)); return res.status(202).json({ ok: true, status: 'accepted' }); }
      const record = await flow.claim(day, ticket);
      if (record) schedule((async () => {
        const services = options.services || await productionServices();
        await flowFor(services, mode).execute(record);
      })());
      return res.status(202).json({ ok: true, status: record ? 'accepted' : 'already_handled' });
    } catch (error) {
      report({ status: 'review_required', reason: /^[a-z_]{1,70}$/.test(error?.code || '') ? error.code : 'morning_flow_unavailable' });
      return res.status(503).json({ ok: false, error: 'morning_flow_unavailable', inspectStatusBeforeRetry: true });
    }
  };
}

export default createMorningFlowHandler();
