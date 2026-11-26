import { pathToFileURL } from 'node:url';
import { DEFAULT_EDITORIAL_OPENAI_MODEL } from '../lib/electric-editorial-ai.js';
import { electricCopyMetadata } from '../lib/electric-editorial-drafts.js';

// Only the public model identifier and a bounded access result can enter build logs.
export async function editorialModelAccess(env, fetchImpl = fetch) {
  const model = env.EDITORIAL_OPENAI_MODEL?.trim() || DEFAULT_EDITORIAL_OPENAI_MODEL;
  if (!/^[a-z0-9.-]{1,80}$/.test(model) || !env.OPENAI_API_KEY) return { available: false, status: 'not_configured' };
  try {
    const response = await fetchImpl('https://api.openai.com/v1/models/' + model, { method: 'GET',
      redirect: 'error', headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      await response.body?.cancel();
      return { model, available: false, status: response.status };
    }
    const info = await response.json();
    return { model, available: info?.id === model, status: response.status };
  } catch { return { model, available: false, status: 'unavailable' }; }
}

function logEdition(log, event, post) {
  const origin = electricCopyMetadata(post);
  if (!post?.provisional && origin.copyOrigin && /^\d{4}-\d{2}-\d{2}$/.test(post.date || '') &&
      typeof post.id === 'string' && /^[A-Za-z0-9_-]{3,120}$/.test(post.id) && post.id.includes(post.date)) {
    log.info(event, JSON.stringify({ date: post.date, id: post.id, ...origin }));
    return origin.copyOrigin;
  }
  log.warn('editorial_next_draft_pending');
}

export async function verifyAndPrepareEditorial(publisher, log = console, checkModel) {
  const result = await publisher.validate();
  if (!result.verified || result.username !== 'autovalorpt') throw Object.assign(new Error(), { code: 'wrong_instagram_account' });
  log.info('editorial_connection_verified', JSON.stringify({ username: result.username, checkedAt: result.checkedAt,
    canPublishNow: result.canPublishNow === true, remaining: result.publishingQuota?.remaining ?? null }));

  // Use the dashboard's dated draft; further builds and the cron reuse it.
  try {
    const { post } = await publisher.preview();
    if (!['v3', 'v4'].includes(post?.version)) return;
    const origin = logEdition(log, 'editorial_next_draft_ready', post);
    if (origin === 'editorial' && checkModel) {
      log.info('editorial_model_access', JSON.stringify(await checkModel()));
      const following = await publisher.prepareFollowingEdition(post.date);
      if (following) logEdition(log, 'editorial_following_draft_ready', following);
    }
  } catch {
    log.warn('editorial_next_draft_pending');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href &&
    process.env.VERCEL_ENV === 'production' && process.env.INSTAGRAM_EDITORIAL_ENABLED === 'true') {
  try {
    const { createInstagramEditorial } = await import('../lib/instagram-editorial.js');
    await verifyAndPrepareEditorial(createInstagramEditorial({
      onCopyStatus({ status, model }) {
        if (status === 'generated') console.info('editorial_copy_generated', JSON.stringify(electricCopyMetadata({ copyOrigin: 'ai', copyModel: model })));
        if (['authentication_failed', 'access_denied', 'disabled', 'not_configured', 'invalid_input', 'timeout', 'model_not_found',
          'model_access_denied', 'catalog_unavailable', 'no_supported_model', 'rate_limited',
          'invalid_output', 'incomplete', 'refused', 'unsupported_claim', 'unavailable'].includes(status))
          console.warn('editorial_copy_fallback', status);
      },
    }), console, () => editorialModelAccess(process.env));
  } catch (error) {
    console.error('editorial_connection_check_failed', /^[a-z_]{3,70}$/.test(error?.code || '') ? error.code : 'editorial_connection_unavailable');
    process.exitCode = 1;
  }
}
