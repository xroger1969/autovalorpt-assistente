const PRODUCTION_ORIGIN = 'https://autovalorpt-assistente.vercel.app';

export function privateLeadOrigin(env = process.env) {
  if (env.VERCEL_ENV !== 'preview') return PRODUCTION_ORIGIN;
  // Use deployment-owned system variables, never a request Host header or a
  // customer field. A branch URL keeps the same isolated lead namespace.
  for (const value of [env.VERCEL_BRANCH_URL, env.VERCEL_URL]) {
    const host = String(value || '').trim().toLowerCase();
    if (/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(host) && `https://${host}` !== PRODUCTION_ORIGIN) {
      return `https://${host}`;
    }
  }
  return null;
}

export function privateLeadUrl(lead, env = process.env) {
  const origin = privateLeadOrigin(env);
  if (!origin) throw new Error('preview_url_not_configured');
  const url = new URL('/leads.html', origin);
  if (/^[a-f0-9]{32}$/.test(String(lead?.id))) url.searchParams.set('lead', lead.id);
  return url.href;
}
