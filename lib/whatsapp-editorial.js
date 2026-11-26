import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';
import { editorialPlan, extraEditorialPlan } from './editorial-content.js';
import { CREDIT_SIMULATOR_URL, scheduledEditorialPlan, SIMULATOR_URL } from './electric-editorial-calendar.js';
import { adviceEditorialPlan } from './editorial-advice-calendar.js';
import { feedEditorialPlan } from './editorial-simulator.js';
import { WHATSAPP_IMAGE_VARIANT } from './whatsapp-editorial-card.js';

const EDITORIAL = 'instagram/editorial/v1/production/state.json';
const HISTORY = 'whatsapp-status/v1/production/editorial.json';
const versions = {
  v1: (date, extra) => extra ? extraEditorialPlan(date) : editorialPlan(date),
  v2: (date, extra) => extra ? null : scheduledEditorialPlan(date),
  v3: adviceEditorialPlan,
  v4: feedEditorialPlan,
};
const safeReels = new Set(['/assets/editorial/rotina-web-v1.mp4', '/assets/editorial/test-drive-web-v1.mp4']);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = code => Object.assign(new Error(code), { code });
const map = value => value && typeof value === 'object' && !Array.isArray(value);
const entries = history => Object.entries(history || {});

function mediaFor(plan, extra) {
  const name = 'AutoValorPT-' + plan.date + (extra ? '-extra' : '-dica');
  if (plan.format === 'REELS') {
    return safeReels.has(plan.videoPath) ? [{ name: name + '.mp4', mime: 'video/mp4', url: plan.videoPath }] : [];
  }
  return plan.slides.map((_, index) => {
    const q = new URLSearchParams({ integration: 'editorial-image', date: plan.date, slide: String(index + 1), v: plan.version });
    if (extra) q.set('extra', '1');
    q.set('variant', WHATSAPP_IMAGE_VARIANT);
    return { name: name + '-' + (index + 1) + '.jpg', mime: 'image/jpeg', url: '/api/stock?' + q };
  });
}

// Keep the archived Instagram text verbatim on the item. A caption for WhatsApp
// can point straight to the same public tool, without requiring an Instagram profile.
function whatsappCopy(plan, caption) {
  // Some older entries contain only a headline. Complete the WhatsApp copy
  // from this exact edition, keeping the text actually sent to Instagram separate.
  const saved = caption.trim();
  if (!saved) caption = plan.caption;
  else if (!saved.includes('\n') && (saved === plan.title || saved.endsWith('?'))) {
    const detail = plan.caption.split(/\n\n+/).filter(paragraph => paragraph !== saved);
    caption = [saved, ...detail].join('\n\n');
  }
  const simulatorUrl = plan.creditSimulatorUrl || plan.simulatorUrl;
  if (![CREDIT_SIMULATOR_URL, SIMULATOR_URL].includes(simulatorUrl)) return { shareCaption: caption };
  const credit = simulatorUrl === CREDIT_SIMULATOR_URL;
  const paragraphs = caption
    .replaceAll(' no link do perfil @autovalorpt.', '.')
    .replaceAll(' nos links do perfil @autovalorpt.', '.')
    .split('\n')
    .filter(line => line.trim() !== simulatorUrl &&
      line.trim() !== (credit ? 'Se ponderas financiar a compra, estima também a prestação.' : 'Abre o comparador de elétrico e combustão.'));
  const body = paragraphs.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const lead = credit ? 'Simula a tua prestação' : 'Compara o custo do elétrico com o de combustão';
  return { simulatorUrl, shareCaption: [lead + '\n' + simulatorUrl, body].filter(Boolean).join('\n\n') };
}

function publishedTip({ date, extra, row }) {
  const version = row.version ?? 'v1';
  if (!Object.hasOwn(versions, version)) return null;
  let plan;
  try { plan = versions[version](date, extra); } catch { return null; }
  if (!plan || plan.version !== version || plan.id !== row.id || plan.format !== row.format ||
      (plan.format === 'REELS' && plan.videoPath !== row.videoPath)) return null;
  const media = mediaFor(plan, extra);
  const caption = typeof row.caption === 'string' ? row.caption : '';
  return media.length ? { id: row.id, date, extra, format: plan.format, title: row.title || plan.title, caption, ...whatsappCopy(plan, caption), media } : null;
}

// The editorial ledger is the source of completed publications. Read it without preparing
// drafts, contacting Instagram or triggering a render. WhatsApp observations live separately.
export function createWhatsappEditorial({ env = process.env, storage = { get, head, put }, now = Date.now } = {}) {
  const accountId = String(env.INSTAGRAM_USER_ID || '');
  const loginMode = env.INSTAGRAM_LOGIN_MODE || 'instagram';
  function configured() {
    if (env.VERCEL_ENV !== 'production' || !/^\d{5,30}$/.test(accountId)) throw fail('status_not_configured');
  }
  async function read(path, forWrite = false) {
    const result = forWrite ? await readInstagramBlob(storage, path)
      : await storage.get(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('status_storage_unavailable');
    const state = await new Response(result.stream).json();
    if (state?.version !== 1 || state.accountId !== accountId || !map(state.items) ||
        state.username !== 'autovalorpt' || state.loginMode !== loginMode) throw fail('status_binding_changed');
    return { state, etag: result.blob.etag };
  }
  async function publications() {
    const record = await read(EDITORIAL);
    if (!record) return [];
    const { items, extraItems } = record.state;
    if (extraItems !== undefined && !map(extraItems)) throw fail('status_storage_unavailable');
    return [...entries(items).map(([date, row]) => ({ date, row, extra: false })),
      ...entries(extraItems).map(([date, row]) => ({ date, row, extra: true }))]
      .filter(({ row }) => row?.status === 'published')
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.row.at || '').localeCompare(String(a.row.at || '')));
  }
  function current(history, id) {
    if (!Object.hasOwn(history, id)) return null;
    const trail = history[id], last = Array.isArray(trail) && trail.at(-1);
    if (!last || !uuid.test(last.id) || !['ready','unconfirmed','confirmed'].includes(last.status))
      throw fail('status_storage_unavailable');
    return last;
  }
  async function list() {
    configured();
    const [rows, history] = await Promise.all([publications(), read(HISTORY)]);
    const items = [], states = history?.state.items || {};
    for (const entry of rows) {
      const attempt = current(states, entry.row.id);
      if (items.length >= 14 && attempt?.status !== 'unconfirmed') continue;
      const tip = publishedTip(entry);
      if (tip) items.push({ ...tip, status: attempt?.status || 'ready',
        ...(attempt && attempt.status !== 'ready' ? { attemptId: attempt.id } : {}) });
    }
    return { ok: true, items };
  }
  async function update(action, input) {
    configured();
    if (!['tip-claim', 'tip-confirm', 'tip-release'].includes(action)) throw fail('status_tip_input_invalid');
    const id = input?.id;
    const claiming = action === 'tip-claim';
    const attemptId = claiming ? input?.requestId : input?.attemptId;
    if (typeof id !== 'string' || !/^(?:editorial|extra)-[\p{Script=Latin}0-9_-]{3,115}$/u.test(id) ||
        typeof attemptId !== 'string' || !uuid.test(attemptId) ||
        action === 'tip-confirm' && input.observed !== true || action === 'tip-release' && input.notSent !== true)
      throw fail('status_tip_input_invalid');
    if (claiming) {
      const entry = (await publications()).find(({ row }) => row.id === id);
      if (!entry || !publishedTip(entry)) throw fail('status_tip_not_available');
    }
    for (let i = 0; i < 2; i++) {
      let record;
      try {
        record = await read(HISTORY, true);
        const state = record?.state || { version: 1, accountId, username: 'autovalorpt', loginMode, items: {} };
        const attempts = state.items[id] || [], previous = current(state.items, id);
        const status = claiming ? 'unconfirmed' : action === 'tip-confirm' ? 'confirmed' : 'ready';
        const response = { ok: true, status, attemptId };
        if (previous?.id === attemptId && previous.status === status) return response;
        const at = new Date(now()).toISOString();
        if (claiming) {
          if ((previous && previous.status !== 'ready') || attempts.some(attempt => attempt.id === attemptId))
            throw fail('status_tip_already_claimed');
          state.items[id] = [...attempts, { id: attemptId, status, startedAt: at }];
        } else {
          if (previous?.id !== attemptId || previous.status !== 'unconfirmed') throw fail('status_tip_attempt_changed');
          Object.assign(previous, { status, resolvedAt: at });
        }
        const saved = await storage.put(HISTORY, JSON.stringify(state), { access: 'private', addRandomSuffix: false,
          allowOverwrite: Boolean(record), ...(record ? { ifMatch: record.etag } : {}), contentType: 'application/json',
          cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000) });
        if (!saved.etag) throw fail('status_storage_unavailable');
        return response;
      } catch (error) {
        if (!instagramStorageConflict(error) && error?.code !== 'blob_read_version_changed') throw error;
        if (i === 1) throw fail('status_conflict');
      }
    }
  }
  return { list, update };
}
