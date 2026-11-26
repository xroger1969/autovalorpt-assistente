import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { adminRequestAuthorized } from './admin-security.js';
import { noStoreHeaders, sameOriginRequest } from './photo-security.js';
import { createMorningFlow } from './morning-flow.js';
import { createMorningFlowDriver } from './morning-flow-driver.js';

async function productionServices({ runBudgetMs = 240000 } = {}) {
  const [source, catalog, publisher, retirements, stories, prepared] = await Promise.all([
    import('./stock-source.js'), import('./meta-catalog.js'), import('./instagram-publisher.js'),
    import('./instagram-retirements.js'), import('./instagram-stories.js'), import('./catalog-photo-source.js')]);
  const inventory = source.createStockSource();
  const catalogue = prepared.createPreparedCatalogSource({ stockSource: inventory,
    prepareBudgetMs: Math.max(0, Math.min(85000, runBudgetMs - 30000)) });
  const options = { loadFeed: inventory.loadFeed };
  return { source: { ...inventory, async sync(input) {
    return prepared.syncCatalogStock(inventory, catalogue, input);
  } }, catalog: catalog.createMetaCatalog({ auditSource: catalogue.audit, runBudgetMs }),
    photo: publisher.createInstagramPublisher(options), retirements: retirements.createInstagramRetirements(options),
    story: stories.createInstagramStories({ ...options, runBudgetMs: Math.max(1, Math.min(240000, runBudgetMs)) }) };
}

export function createMorningFlowHandler(options = {}) {
  const env = options.env || process.env;
  const background = options.waitUntil || waitUntil;
  const isAdmin = options.authorizeAdmin || (req => adminRequestAuthorized(req, env));
  const report = options.report || (entry => console.error('morning_flow_failed', JSON.stringify(entry)));
  const localDriver = options.localDriver ?? !options.fetchImpl;
  const flowFor = (services, mode = 'scheduled', dispatch) => options.flow || createMorningFlow({ ...options, env, services, mode,
    ...(dispatch ? { dispatch } : {}) });
  const schedule = work => background(work.catch(error => report({ status: 'review_required',
    reason: /^[a-z_]{1,70}$/.test(error?.code || '') ? error.code : 'morning_step_interrupted' })));
  return async (req, res) => {
    noStoreHeaders(res); res.setHeader('Referrer-Policy', 'no-referrer');
    const expected = Buffer.from(String(env.CRON_SECRET || ''));
    const supplied = Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer /, ''));
    const cron = expected.length >= 32 && expected.length === supplied.length && timingSafeEqual(expected, supplied);
    const action = String(req.query?.action || 'status');
    const mode = action === 'manual-start' ? 'manual' : String(req.query?.mode || 'scheduled');
    if ((!cron || action === 'latest-prior') && !isAdmin(req)) return res.status(401).json({ ok: false, error: 'private_access_required' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    if (!['status', 'latest-prior', 'start', 'manual-start', 'resume', 'continue', 'delay'].includes(action) ||
        !['scheduled', 'manual'].includes(mode)) return res.status(400).json({ ok: false, error: 'invalid_action' });
    if (action === 'latest-prior' && req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    if (action === 'latest-prior' && mode !== 'scheduled') return res.status(400).json({ ok: false, error: 'invalid_action' });
    if (['continue', 'delay'].includes(action) && (!cron || req.method !== 'POST')) return res.status(403).json({ ok: false, error: 'server_callback_required' });
    if (action === 'start' && mode !== 'scheduled') return res.status(403).json({ ok: false, error: 'server_callback_required' });
    if (action === 'start' && !cron && (req.method !== 'POST' || !sameOriginRequest(req))) return res.status(403).json({ ok: false, error: 'admin_post_required' });
    if (action === 'manual-start' && (!isAdmin(req) || req.method !== 'POST' || !req.headers?.origin || !sameOriginRequest(req)))
      return res.status(403).json({ ok: false, error: 'admin_post_required' });
    if (action === 'resume' && (req.method !== 'POST' || !cron && (!isAdmin(req) || !req.headers?.origin || !sameOriginRequest(req))))
      return res.status(403).json({ ok: false, error: 'admin_post_required' });
    try {
      const flow = flowFor(undefined, mode);
      const drive = delivery => createMorningFlowDriver({
        flowFor: (services, dispatch) => flowFor(services, mode, dispatch),
        createServices: settings => options.createServices ? options.createServices(settings) : options.services || productionServices(settings),
        runtimeNow: options.runtimeNow, pause: options.pause, budgetMs: options.driverBudgetMs,
        minRemainingMs: options.driverMinRemainingMs, report,
      }).run(delivery);
      if (action === 'status') return res.status(200).json(await flow.status(req.query?.day));
      if (action === 'latest-prior') return res.status(200).json(await flow.latestPrior());
      if (action === 'start' || action === 'manual-start' || action === 'resume') {
        const result = action === 'resume' ? await flow.resume() : await flow.start();
        if (result.delivery) schedule(localDriver ? drive(result.delivery) : flow.deliver(result.delivery.day, result.delivery.ticket, result.delivery.waitMs));
        return res.status(result.delivery ? 202 : 200).json({ ...result, delivery: undefined });
      }
      const { day, ticket } = req.query || {};
      if (localDriver) {
        schedule(drive({ day, ticket, waitMs: action === 'delay' ? 30000 : 0 }));
        return res.status(202).json({ ok: true, status: 'accepted' });
      }
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

