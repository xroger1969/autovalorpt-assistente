import { pathToFileURL } from 'node:url';
import { electricCopyMetadata } from '../lib/electric-editorial-drafts.js';

export async function verifyAndPrepareEditorial(publisher, log = console) {
  const result = await publisher.validate();
  if (!result.verified || result.username !== 'autovalorpt') throw Object.assign(new Error(), { code: 'wrong_instagram_account' });
  log.info('editorial_connection_verified', JSON.stringify({ username: result.username, checkedAt: result.checkedAt,
    canPublishNow: result.canPublishNow === true, remaining: result.publishingQuota?.remaining ?? null }));

  // Use the dashboard's dated draft; further builds and the cron reuse it.
  try {
    const { post } = await publisher.preview();
    if (post?.version !== 'v3') return;
    const origin = electricCopyMetadata(post);
    if (!post.provisional && origin.copyOrigin && typeof post.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(post.date) && typeof post.id === 'string' &&
        /^[A-Za-z0-9_-]{3,120}$/.test(post.id) && post.id.includes(post.date)) {
      log.info('editorial_next_draft_ready', JSON.stringify({ date: post.date, id: post.id, ...origin }));
    } else if (post.provisional) {
      log.warn('editorial_next_draft_pending');
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
      onCopyStatus({ status }) {
        if (['disabled', 'not_configured', 'invalid_input', 'timeout', 'model_unavailable', 'rate_limited',
          'invalid_output', 'incomplete', 'refused', 'unsupported_claim', 'unavailable'].includes(status))
          console.warn('editorial_copy_fallback', status);
      },
    }));
  } catch (error) {
    console.error('editorial_connection_check_failed', /^[a-z_]{3,70}$/.test(error?.code || '') ? error.code : 'editorial_connection_unavailable');
    process.exitCode = 1;
  }
}
