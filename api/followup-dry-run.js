import crypto from 'node:crypto';
import { noStoreHeaders, readJsonBody } from '../lib/photo-security.js';
import { runFollowUpDryRun } from '../lib/followup-dry-run.js';

function configuredToken() {
  return String(process.env.FOLLOWUP_DRY_RUN_TOKEN || '').trim();
}

function bearerToken(req) {
  const header = String(req?.headers?.authorization || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function safeTokenMatch(received = '', expected = '') {
  if (!received || !expected) return false;
  const actual = Buffer.from(received);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export default async function handler(req, res) {
  noStoreHeaders(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'use_post' });

  const expected = configuredToken();
  if (!expected) return res.status(503).json({ ok: false, error: 'dry_run_not_configured' });
  if (!safeTokenMatch(bearerToken(req), expected)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }

  try {
    const body = await readJsonBody(req, 8 * 1024);
    const requestedNow = body?.now ? new Date(body.now) : new Date();
    if (Number.isNaN(requestedNow.getTime())) {
      return res.status(400).json({ ok: false, error: 'invalid_now' });
    }

    const report = await runFollowUpDryRun(requestedNow, {
      timeZone: 'Europe/Lisbon',
      limit: Math.min(500, Math.max(1, Number(body?.limit || 200)))
    });

    return res.status(200).json({ ok: true, ...report });
  } catch (error) {
    console.error('followup_dry_run_failed', error?.message || error);
    return res.status(500).json({ ok: false, error: 'dry_run_failed' });
  }
}
