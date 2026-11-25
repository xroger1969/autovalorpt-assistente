// Keep the legacy actions usable by the morning flow and existing clients.
// The Instagram archive is permanent, including posts about sold vehicles.
export function createInstagramRetirements({ env = process.env } = {}) {
  const configuration = {
    enabled: false, production: env.VERCEL_ENV === 'production',
    username: 'autovalorpt', maxRetirementsPerRun: 0,
  };
  return {
    status: async () => ({ ok: true, status: 'disabled', retired: 0, configuration, items: [], lastResult: null }),
    dryRun: async () => ({ ok: true, status: 'disabled', configuration, candidates: [] }),
    run: async () => ({ ok: true, status: 'disabled', retired: 0 }),
  };
}
