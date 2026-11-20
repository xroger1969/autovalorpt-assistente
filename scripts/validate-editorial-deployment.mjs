// A deployment check, not a publishing job. Existing server credentials remain
// inside Vercel; only the expected account and a safe result are written to logs.
if (process.env.VERCEL_ENV === 'production' && process.env.INSTAGRAM_EDITORIAL_ENABLED === 'true') {
  try {
    const { createInstagramEditorial } = await import('../lib/instagram-editorial.js');
    const result = await createInstagramEditorial().validate();
    if (!result.verified || result.username !== 'autovalorpt') throw Object.assign(new Error(), { code: 'wrong_instagram_account' });
    console.info('editorial_connection_verified', JSON.stringify({ username: result.username, checkedAt: result.checkedAt,
      canPublishNow: result.canPublishNow === true, remaining: result.publishingQuota?.remaining ?? null }));
  } catch (error) {
    console.error('editorial_connection_check_failed', /^[a-z_]{3,70}$/.test(error?.code || '') ? error.code : 'editorial_connection_unavailable');
    process.exitCode = 1;
  }
}
