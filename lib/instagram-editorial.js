import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict as conflict } from './instagram-storage.js';
import { createInstagramTokenManager } from './instagram-token.js';
import { editorialPlan, extraEditorialPlan, EDITORIAL_START_DATE, EDITORIAL_VERSION } from './editorial-content.js';
import { scheduledEditorialPlan, ELECTRIC_IMAGE_VERSION } from './electric-editorial-calendar.js';
import { editorialImageTheme, PREMIUM_EDITORIAL_THEME, PREMIUM_REEL_COVER_VARIANT, captionSuggestion, feedEditorialPlan, SIMULATOR_IMAGE_VERSION, withSimulatorAccess } from './editorial-simulator.js';
import { ADVICE_IMAGE_VERSION, adviceEditorialPlan } from './editorial-advice-calendar.js';
import { createElectricDrafts, electricCopyMetadata } from './electric-editorial-drafts.js';
import { prepareElectricEdition } from './electric-editorial-edition.js';
import { costCorrection, costCorrectionImage } from './editorial-cost-correction.js';

const USERNAME = 'autovalorpt';
const TIMEZONE = 'Europe/Lisbon';
const LEASE_MS = 5 * 60_000;
const DAY_MS = 86400_000;
const APPROVED_REELS = new Map([
  ['2026-11-22', '/assets/editorial/rotina-web-v1.mp4'],
  ['2026-11-29', '/assets/editorial/test-drive-web-v1.mp4'],
]);
const fail = code => Object.assign(new Error(code), { code });
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const numericId = value => /^\d{5,30}$/.test(String(value || ''));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const followingDay = day => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const safeFailure = error => ({ reason: /^[a-z_]{1,70}$/.test(error?.code || '') ? error.code : 'editorial_unavailable',
  ...(Number.isSafeInteger(error?.metaStatus) ? { metaStatus: error.metaStatus } : {}),
  ...(Number.isSafeInteger(error?.metaCode) ? { metaCode: error.metaCode } : {}) });

/** The server clock, never a requested date, decides the publication slot. */
export function editorialClock(value = Date.now()) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw fail('editorial_date_invalid');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const localMinute = Date.parse(`${day}T${parts.hour}:${parts.minute}:00Z`);
  const utcMinute = Math.floor(instant.getTime() / 60_000) * 60_000;
  const offsetMinutes = (localMinute - utcMinute) / 60_000;
  return { day, hour: Number(parts.hour), minute: Number(parts.minute), offsetMinutes,
    season: offsetMinutes === 60 ? 'summer' : 'winter' };
}

export function editorialDue(value = Date.now(), { season } = {}) {
  const local = editorialClock(value);
  if (season !== undefined && !['summer', 'winter'].includes(season)) return { due: false, reason: 'invalid_season', ...local };
  if (local.day < EDITORIAL_START_DATE) return { due: false, reason: 'not_started', ...local };
  if (season && season !== local.season) return { due: false, reason: 'inactive_season', ...local };
  if (local.hour < 19) return { due: false, reason: 'before_schedule', ...local };
  return { due: true, ...local };
}

function scheduledAt(day) {
  // Lisbon changes offset in the morning. Noon and 19:00 always share it.
  const offset = editorialClock(`${day}T12:00:00Z`).offsetMinutes;
  return new Date(Date.parse(`${day}T19:00:00Z`) - offset * 60_000).toISOString();
}

function imageOrigin(env) {
  try {
    const source = env.INSTAGRAM_PUBLIC_BASE_URL ||
      (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
    const url = new URL(source);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      url.pathname === '/' && /\.[a-z]{2,}$/i.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname) ? url.origin : '';
  } catch { return ''; }
}

export function editorialImageUrl(day, slide, env = process.env, extra = false, version = EDITORIAL_VERSION) {
  if (!validDay(day) || !Number.isInteger(slide) || slide < 1 || slide > 10 || !imageOrigin(env)) throw fail('editorial_image_invalid');
  if (version === costCorrection.version) {
    if (day !== costCorrection.date || extra !== true || slide !== 1) throw fail('editorial_image_invalid');
    return new URL(costCorrectionImage, imageOrigin(env)).href;
  }
  const url = new URL('/api/stock', imageOrigin(env));
  url.searchParams.set('integration', 'editorial-image');
  url.searchParams.set('date', day); url.searchParams.set('slide', String(slide));
  if (![EDITORIAL_VERSION, ELECTRIC_IMAGE_VERSION, ADVICE_IMAGE_VERSION, SIMULATOR_IMAGE_VERSION].includes(version)) throw fail('editorial_image_invalid');
  const theme = editorialImageTheme(day, extra, version);
  if (theme) url.searchParams.set('theme', theme);
  url.searchParams.set('v', version); if (extra === true) url.searchParams.set('extra', '1');
  return url.href;
}

function reelCoverUrl(post, env) {
  if (post.format !== 'REELS' || editorialImageTheme(post.date, post.extra === true, post.version) !== PREMIUM_EDITORIAL_THEME) return undefined;
  const url = new URL(editorialImageUrl(post.date, 1, env, post.extra === true, post.version));
  url.searchParams.set('variant', PREMIUM_REEL_COVER_VARIANT);
  return url.href;
}

function reelUrl(post, env) {
  if (post.format !== 'REELS' || APPROVED_REELS.get(post.date) !== post.videoPath || !imageOrigin(env))
    throw fail('editorial_video_not_approved');
  return new URL(post.videoPath, imageOrigin(env)).href;
}

export function createInstagramEditorial(options = {}) {
  const env = options.env || process.env;
  const storage = options.storage || { get, head, put };
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const planFor = options.planFor || feedEditorialPlan;
  const extraPlanFor = options.extraPlanFor || (day => feedEditorialPlan(day, true));
  const tokens = options.tokenManager || createInstagramTokenManager({ env, storage, fetchImpl, now });
  const loginMode = env.INSTAGRAM_LOGIN_MODE || 'instagram';
  // Editorial media uses the current API's native AI label. The established
  // stock publisher and token manager retain their own pinned API version.
  const graphVersion = env.INSTAGRAM_EDITORIAL_GRAPH_VERSION || 'v27.0';
  const configuration = {
    production: env.VERCEL_ENV === 'production', tokenConfigured: Boolean(env.INSTAGRAM_ACCESS_TOKEN),
    accountConfigured: numericId(env.INSTAGRAM_USER_ID), imagesConfigured: Boolean(imageOrigin(env)),
    validApi: ['instagram', 'facebook'].includes(loginMode) && /^v\d{2}\.0$/.test(graphVersion),
    loginMode, graphVersion, username: USERNAME, maxPostsPerDay: 1, maxExtraPostsPerDay: 1,
  };
  const namespace = configuration.production ? 'production' : `preview-${hash(env.VERCEL_GIT_COMMIT_REF || 'development').slice(0, 12)}`;
  const path = `instagram/editorial/v1/${namespace}/state.json`;
  const frozenDraft = createElectricDrafts({ storage, namespace,
    prepare: options.prepareElectricEdition || (post => prepareElectricEdition(post, { env, fetchImpl, onStatus: options.onCopyStatus })) });
  async function draftFor(post) {
    if (post.version !== SIMULATOR_IMAGE_VERSION) return frozenDraft(post);
    // Both layouts share the same dated source text, model attribution and storage lease.
    const original = adviceEditorialPlan(post.date, post.extra === true);
    return withSimulatorAccess(await frozenDraft(original));
  }
  const timestamp = () => new Date(now()).toISOString();
  const enabled = state => state?.enabled ?? env.INSTAGRAM_EDITORIAL_ENABLED === 'true';
  const ready = () => {
    if (!configuration.production) throw fail('production_required');
    if (!configuration.tokenConfigured || !configuration.accountConfigured || !configuration.validApi || !configuration.imagesConfigured)
      throw fail('editorial_not_configured');
  };

  function bind(state) {
    if (state.accountId !== String(env.INSTAGRAM_USER_ID) || state.username !== USERNAME || state.loginMode !== loginMode)
      throw fail('editorial_account_changed');
  }
  async function read({ snapshotOnly = false } = {}) {
    // Displaying the calendar needs a single snapshot. Only writers and the
    // existing reconciliation flow need the strong ETag for conditional updates.
    const result = snapshotOnly
      ? await storage.get(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(8000) })
      : await readInstagramBlob(storage, path);
    if (!result) return null;
    if (result.statusCode !== 200 || !result.blob?.etag) throw fail('editorial_state_unavailable');
    let state;
    try { state = JSON.parse(await new Response(result.stream).text()); } catch { throw fail('editorial_state_invalid'); }
    if (state.version !== 1 || !state.items || typeof state.items !== 'object' || Array.isArray(state.items) ||
        state.enabled !== undefined && typeof state.enabled !== 'boolean' || state.extraItems !== undefined && (!state.extraItems || typeof state.extraItems !== 'object' || Array.isArray(state.extraItems))) throw fail('editorial_state_invalid');
    bind(state);
    return { state, etag: result.blob.etag };
  }
  function initialState() {
    return { version: 1, accountId: String(env.INSTAGRAM_USER_ID), username: USERNAME, loginMode,
      initializedAt: timestamp(), contentVersion: EDITORIAL_VERSION, items: {}, active: null, lastResult: null };
  }
  async function save(record) {
    const result = await storage.put(path, JSON.stringify(record.state), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json', cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(8_000),
    });
    if (!result.etag) throw fail('editorial_state_unavailable');
    record.etag = result.etag;
  }

  async function graph(resource, { method = 'GET', fields, body, token, deadline = Date.now() + 12_000 } = {}) {
    if (Date.now() >= deadline) throw fail('editorial_deadline_reached');
    const base = loginMode === 'facebook' ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
    const url = new URL(`${base}/${graphVersion}/${resource}`);
    if (fields) url.searchParams.set('fields', fields);
    let response;
    try {
      response = await fetchImpl(url.href, { method, headers: { Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      signal: AbortSignal.timeout(Math.max(1, Math.min(12_000, deadline - Date.now()))), redirect: 'error' });
    } catch { throw fail('meta_transport_unknown'); }
    const data = await response.json().catch(() => null);
    // Provider bodies and request URLs can contain secrets. Persist only codes.
    if (!response.ok || !data || data.error) {
      const failure = fail('meta_request_failed'); failure.metaStatus = response.status;
      if (Number.isSafeInteger(data?.error?.code)) failure.metaCode = data.error.code;
      throw failure;
    }
    return data;
  }
  async function verifyAccount(token, deadline) {
    const instagram = loginMode === 'instagram';
    const account = await graph(instagram ? 'me' : String(env.INSTAGRAM_USER_ID), {
      fields: instagram ? 'user_id,username' : 'id,username', token, deadline });
    if (String(instagram ? account.user_id : account.id) !== String(env.INSTAGRAM_USER_ID) ||
        String(account.username).toLowerCase() !== USERNAME) throw fail('wrong_instagram_account');
  }
  async function validate() {
    ready();
    await read();
    const token = await tokens.resolve();
    await verifyAccount(token);
    // This read checks the documented publication endpoint without creating a
    // container. Meta still enforces publication permissions on every write.
    const limits = await graph(`${env.INSTAGRAM_USER_ID}/content_publishing_limit`, { fields: 'quota_usage,config', token });
    const limit = limits.data?.[0];
    if (!Array.isArray(limits.data) || limits.data.length !== 1 ||
        !Number.isSafeInteger(limit?.quota_usage) || limit.quota_usage < 0 ||
        !Number.isSafeInteger(limit?.config?.quota_total) || limit.config.quota_total < 1 ||
        limit.config.quota_duration !== undefined &&
          (!Number.isSafeInteger(limit.config.quota_duration) || limit.config.quota_duration < 1))
      throw fail('editorial_publishing_limit_invalid');
    const remaining = Math.max(0, limit.config.quota_total - limit.quota_usage);
    return { ok: true, verified: true, username: USERNAME, checkedAt: timestamp(), canPublishNow: remaining > 0,
      publishingQuota: { usage: limit.quota_usage, total: limit.config.quota_total, remaining,
        ...(limit.config.quota_duration === undefined ? {} : { durationSeconds: limit.config.quota_duration }) } };
  }
  function boundPlan(day, extra, saved) {
    if (extra && day === costCorrection.date && saved?.id === costCorrection.id) return costCorrection;
    const post = extra ? extraPlanFor(day) : planFor(day);
    if (!saved?.id || saved.id === post.id) return post;
    const advice = adviceEditorialPlan(day, extra);
    if (advice.id === saved.id) return advice;
    const earlier = extra ? [extraEditorialPlan(day)] : [scheduledEditorialPlan(day), editorialPlan(day)];
    return earlier.find(candidate => candidate.id === saved.id) || post;
  }
  function plan(day, extra = false, saved) {
    if (!validDay(day) || day < EDITORIAL_START_DATE) throw fail('editorial_date_invalid');
    const post = boundPlan(day, extra, saved);
    if (!post || post.date !== day || !/^[\p{Script=Latin}0-9_-]{3,120}$/u.test(post.id || '') ||
        typeof post.caption !== 'string' || !post.caption.trim() || post.caption.length > 2200 ||
        typeof post.title !== 'string' || !post.title.trim() || post.title.length > 220 ||
        !['IMAGE', 'CAROUSEL', 'REELS'].includes(post.format) || !Array.isArray(post.slides) ||
        (post.format === 'IMAGE' && post.slides.length !== 1) ||
        (post.format === 'CAROUSEL' && (post.slides.length < 2 || post.slides.length > 10)) ||
        (post.format === 'REELS' && (post.slides.length > 1 || post.aiGenerated !== true || !/\bIA\b|inteligência artificial/i.test(post.caption))))
      throw fail('editorial_content_invalid');
    if (post.format === 'REELS') {
      if (Number(graphVersion.slice(1, -2)) < 27) throw fail('editorial_ai_label_api_required');
      reelUrl(post, env);
    }
    return post;
  }
  function postSummary(post) {
    return { id: post.id, date: post.date, title: post.title, topic: post.topic, format: post.format,
      version: post.version || EDITORIAL_VERSION, ...electricCopyMetadata(post),
      caption: post.caption, slideCount: post.slides.length, ...(post.extra === true ? { extra: true } : {}),
      ...(post.simulatorUrl ? { simulatorUrl: post.simulatorUrl } : {}),
      ...(post.creditSimulatorUrl ? { creditSimulatorUrl: post.creditSimulatorUrl } : {}),
      ...(post.sources ? { sources: post.sources } : {}), ...(post.provisional ? { provisional: true } : {}),
      images: configuration.imagesConfigured ? post.slides.map((_, index) => editorialImageUrl(post.date, index + 1, env, post.extra === true, post.version)) : [],
      ...(post.format === 'REELS' ? { ...(configuration.imagesConfigured ? { videoUrl: reelUrl(post, env),
        ...(reelCoverUrl(post, env) ? { coverUrl: reelCoverUrl(post, env) } : {}) } : {}), aiGenerated: true } : {}) };
  }
  function nextDay(state) {
    const current = editorialClock(now());
    let day = current.day < EDITORIAL_START_DATE ? EDITORIAL_START_DATE : current.day;
    // A completed daily slot is never reassigned to new content by a deployment.
    if (state?.items?.[day]?.status === 'published' || state?.items?.[day]?.attempts >= 3 ||
        day === current.day && current.hour >= 20 && !state?.active) day = followingDay(day);
    return day;
  }
  async function previewPlan(day, state) {
    const saved = state?.active?.date === day && !state.active.extra ? state.active : state?.items?.[day];
    const post = plan(day, false, saved);
    if (saved?.id && saved.id !== post.id) throw fail('editorial_historic_preview_unavailable');
    if (saved?.caption) return { ...post, caption: saved.caption, sources: saved.sources || [], ...electricCopyMetadata(saved) };
    if (!post.electric) return post;
    const today = editorialClock(now()).day;
    if (configuration.production && enabled(state) && day >= today && day <= followingDay(today)) {
      try { return await draftFor(post); }
      catch { /* The dashboard can still show the artwork while a draft is unavailable. */ }
    }
    return { ...post, provisional: true };
  }
  async function status() {
    const record = await read(); const state = record?.state;
    const day = nextDay(state);
    const history = [...Object.entries(state?.items || {}).map(([date,item])=>({date,...item})), ...Object.entries(state?.extraItems || {}).map(([date,item])=>({date,...item,extra:true}))].sort((a,b)=>b.date.localeCompare(a.date) || String(b.at || '').localeCompare(String(a.at || ''))).slice(0,14).map(captionSuggestion);
    const local = editorialClock(now()); const extraItem = state?.extraItems?.[local.day]; const active = state?.active;
    const mode = extraMode(state, local.day);
    const shownExtra = active?.extra && mode ? active : extraItem;
    const extraDay = active?.extra && mode ? active.date : local.day;
    return { ok: true, enabled: enabled(state), configuration, authorization: await tokens.status(),
      schedule: { timezone: TIMEZONE, time: '19:00', startsOn: EDITORIAL_START_DATE, nextRunAt: scheduledAt(day) },
      nextPost: postSummary(await previewPlan(day, state)), history,
      extra: { available: Boolean(mode), resumable: mode === 'resume' || mode === 'verify', verifyOnly: mode === 'verify',
        ...(mode && local.day === costCorrection.date && (!active || active.id === costCorrection.id) ? { correctionId: costCorrection.id } : {}),
        usedToday: extraItem?.status === 'published', lastResult: state?.lastExtraResult || null,
        nextPost: local.day >= EDITORIAL_START_DATE ? postSummary(plan(extraDay, true, shownExtra)) : null },
      active: state?.active ? { date: state.active.date, id: state.active.id, title: state.active.title,
        phase: state.active.phase, startedAt: state.active.startedAt, ...(state.active.extra === true ? {extra:true} : {}) } : null,
      lastResult: state?.lastResult || null };
  }
  async function calendar() {
    const state = (await read({ snapshotOnly: true }))?.state;
    const active = state?.active;
    const on = enabled(state);
    const configured = configuration.production && configuration.tokenConfigured && configuration.accountConfigured &&
      configuration.validApi && configuration.imagesConfigured;
    const blocked = active?.phase === 'unknown' ||
      (active?.phase === 'publishing' && !(now() - Date.parse(active.startedAt) < LEASE_MS));
    const items = [];
    let day = nextDay(state);
    for (let index = 0; index < 7; index++, day = followingDay(day)) {
      const current = active?.date === day && !active.extra ? active : null;
      const saved = current || state?.items?.[day];
      const post = boundPlan(day, false, saved);
      let status = !on ? 'paused' : blocked ? 'review_required' : configured ? 'scheduled' : 'unavailable';
      if (current) status = current.phase === 'unknown' || current.phase === 'publishing' && blocked ? 'review_required' : current.phase;
      else if (['published', 'failed', 'skipped'].includes(saved?.status)) status = saved.status;

      if (saved?.id && saved.id !== post.id) {
        // The original artwork cannot be recovered from a date alone after a
        // plan change. Report the recorded attempt without unrelated previews.
        items.push({ id: saved.id, date: day, title: saved.title, topic: saved.topic, format: saved.format,
          caption: saved.caption || '', sources: saved.sources || [], ...electricCopyMetadata(saved), provisional: !saved.caption, status,
          scheduledAt: scheduledAt(day), slideCount: 0, images: [], altTexts: [] });
        continue;
      }
      const frozen = typeof saved?.caption === 'string' && saved.caption.trim().length > 0;
      const summary = postSummary(frozen ? { ...post, caption: saved.caption, sources: saved.sources || [], ...electricCopyMetadata(saved) } : post);
      items.push({ ...summary, status, provisional: !frozen, scheduledAt: scheduledAt(day),
        altTexts: post.slides.map(slide => slide.altText || slide.title) });
    }
    return { ok: true, enabled: on, blocked, timezone: TIMEZONE, time: '19:00', items };
  }
  async function preview(day) {
    const record = await read();
    return { ok: true, post: postSummary(await previewPlan(day === undefined ? nextDay(record?.state) : day, record?.state)) };
  }

  // A production deployment can verify the writer against one following daily edition.
  // Reuse that edition's durable draft when it reaches the dashboard or the cron.
  async function prepareFollowingEdition(firstDay) {
    if (!configuration.production) return null;
    const state = (await read({ snapshotOnly: true }))?.state;
    if (!enabled(state) || nextDay(state) !== firstDay) return null;
    const day = followingDay(firstDay);
    const candidate = plan(day);
    if (![ADVICE_IMAGE_VERSION, SIMULATOR_IMAGE_VERSION].includes(candidate.version) || state?.items?.[day] || state?.active?.date === day) return null;
    return postSummary(await draftFor(candidate));
  }

  function extraMode(state, day) {
    if (!configuration.production || !enabled(state) || day < EDITORIAL_START_DATE) return null;
    const active = state?.active;
    if (active) {
      if (!active.extra) return null;
      if (active.phase === 'preparing' && active.date === day) return 'resume';
      if (['creating', 'publishing', 'unknown'].includes(active.phase) &&
          now() - Date.parse(active.startedAt) >= LEASE_MS) return 'verify';
      return null;
    }
    const previous = state?.extraItems?.[day];
    return previous?.status === 'published' || previous?.attempts >= 3 ? null : 'publish';
  }

  async function extraReview(state, today, session, confirmation, edition) {
    if (!/^[a-f0-9]{64}$/.test(session || '') || String(env.ADMIN_SESSION_SECRET || '').length < 32)
      throw fail('editorial_review_session_invalid');
    const mode = extraMode(state, today);
    if (!mode) throw fail('editorial_review_stale');
    const active = state?.active;
    const day = active?.date || today;
    const correctionRequested = edition === costCorrection.id || confirmation?.id === costCorrection.id;
    if (edition !== undefined && edition !== costCorrection.id ||
        correctionRequested && (day !== costCorrection.date || active && active.id !== costCorrection.id))
      throw fail('editorial_review_stale');
    const base = plan(day, true, active || (correctionRequested ? costCorrection : undefined));
    if (active && (active.id !== base.id || (active.baseFingerprint || active.fingerprint) !== hash(JSON.stringify(base))))
      throw fail('editorial_review_stale');
    if (confirmation && confirmation.id !== base.id) throw fail('editorial_review_stale');
    const post = active ? { ...base, caption: active.caption, ...(active.sources ? { sources: active.sources } : {}),
      ...electricCopyMetadata(active) } : base.electric ? await draftFor(base) : base;
    const summary = { ...postSummary(post), altTexts: post.slides.map(slide => slide.altText || slide.title) };
    // The session, attempt and prior result bind both fresh and retried confirmations.
    // A receipt for 'publish' must never turn into permission to resume another attempt.
    const fingerprint = createHmac('sha256', env.ADMIN_SESSION_SECRET).update(JSON.stringify([
      'editorial-extra-review-v1', env.INSTAGRAM_USER_ID, session, today, mode, active?.attemptId || '',
      state?.extraItems?.[day]?.attempts || 0, hash(JSON.stringify([summary, post.slides])),
    ])).digest('hex');
    if (confirmation && !timingSafeEqual(Buffer.from(confirmation.fingerprint, 'hex'), Buffer.from(fingerprint, 'hex')))
      throw fail('editorial_review_stale');
    return { post, base, mode, summary: { ...summary, fingerprint } };
  }

  async function extraPreview(session, edition) {
    ready();
    const state = (await read({ snapshotOnly: true }))?.state;
    const review = await extraReview(state, editorialClock(now()).day, session, undefined, edition);
    return { ok: true, mode: review.mode, post: review.summary };
  }
  async function setEnabled(value) {
    if (typeof value !== 'boolean') throw fail('editorial_setting_invalid');
    if (value) await validate();
    const record = await read() || { state: initialState() };
    record.state.enabled = value;
    record.state.settingsUpdatedAt = timestamp();
    try { await save(record); } catch (error) { if (conflict(error)) throw fail('editorial_settings_changed'); throw error; }
    return status();
  }
  function permalink(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname) &&
        !url.username && !url.password && !url.port && !url.search && !url.hash &&
        /^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url.href : null;
    } catch { return null; }
  }
  // Public monitoring gets only a URL already confirmed by a completed run.
  // Never resolve authorization, query Meta, expose a draft or mutate state.
  async function postLink(day) {
    if (!validDay(day)) return null;
    const item = (await read())?.state.items[day];
    return item?.status === 'published' ? permalink(item.permalink) : null;
  }
  async function finish(record, outcome, details = {}) {
    const active = record.state.active;
    const entry = { id: active.id, title: active.title, topic: active.topic, topicId: active.topicId,
      format: active.format, ...(active.version ? { version: active.version } : {}), ...electricCopyMetadata(active),
      ...(active.videoPath ? { videoPath: active.videoPath } : {}),
      ...(active.caption ? { caption: active.caption } : {}), ...(active.sources ? { sources: active.sources } : {}),
      status: outcome, attempts: active.attempts, at: timestamp(), ...details };
    const items = active.extra === true ? (record.state.extraItems ||= {}) : record.state.items;
    items[active.date] = entry;
    record.state.active = null;
    record.state[active.extra === true ? 'lastExtraResult' : 'lastResult'] = { status: outcome, date: active.date, id: active.id, at: timestamp(), ...details };
    await save(record);
    return { ok: ['published', 'skipped'].includes(outcome), status: outcome, date: active.date, id: active.id,
      published: outcome === 'published' && !details.reconciled ? 1 : 0, ...details };
  }
  async function publishedDetails(active, request, mediaId) {
    if (numericId(mediaId)) {
      try {
        const media = await request(String(mediaId), { fields: active.format === 'REELS' ? 'permalink,is_ai_generated' : 'permalink' });
        return { mediaId: String(mediaId), ...(permalink(media.permalink) ? { permalink: permalink(media.permalink) } : {}),
          ...(active.format === 'REELS' ? { aiLabelConfirmed: media.is_ai_generated === true,
            ...(media.is_ai_generated !== true ? { reason: 'ai_label_unconfirmed' } : {}) } : {}) };
      } catch { return { mediaId: String(mediaId) }; }
    }
    // A timeout can lose the media ID. A PUBLISHED container is authoritative;
    // locate a link only when one recent media item matches the saved caption.
    try {
      const media = await request(`${env.INSTAGRAM_USER_ID}/media`, { fields: `id,caption,permalink,timestamp${active.format === 'REELS' ? ',is_ai_generated' : ''}` });
      const matches = (Array.isArray(media.data) ? media.data : []).filter(item => numericId(item.id) &&
        item.caption === active.caption && Number.isFinite(Date.parse(item.timestamp)) &&
        Date.parse(item.timestamp) >= Date.parse(active.createdAt) - 5 * 60_000 &&
        Date.parse(item.timestamp) <= now() + 5 * 60_000 && permalink(item.permalink));
      if (matches.length === 1) return { mediaId: String(matches[0].id), permalink: permalink(matches[0].permalink),
        ...(active.format === 'REELS' ? { aiLabelConfirmed: matches[0].is_ai_generated === true,
          ...(matches[0].is_ai_generated !== true ? { reason: 'ai_label_unconfirmed' } : {}) } : {}) };
    } catch { /* Publication remains confirmed even if a link cannot be read. */ }
    return {};
  }

  async function run({ season, extra = false, confirmation, session } = {}) {
    extra = extra === true;
    if (extra && (!confirmation || typeof confirmation.id !== 'string' || confirmation.id.length > 120 ||
        typeof confirmation.fingerprint !== 'string' || confirmation.fingerprint.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(confirmation.fingerprint))) throw fail('editorial_confirmation_required');
    const due = extra ? { ...editorialClock(now()), due: true } : editorialDue(now(), { season });
    if (extra && due.day < EDITORIAL_START_DATE) return {ok:true,status:'not_started',published:0};
    if (!due.due) return { ok: true, status: due.reason, published: 0 };
    let record = await read();
    if (!enabled(record?.state)) return { ok: true, status: 'disabled', published: 0 };
    ready();
    const deadline = Date.now() + Math.max(15_000, Math.min(225_000, options.runBudgetMs || 225_000));
    const review = extra ? await extraReview(record?.state, due.day, session, confirmation) : null;
    if (extra && editorialClock(now()).day !== due.day) throw fail('editorial_review_stale');
    const token = await tokens.resolve();
    const request = (resource, args = {}) => graph(resource, { ...args, token, deadline });
    await verifyAccount(token, deadline);
    record ||= { state: initialState() };

    if (record.state.active) {
      const active = record.state.active;
      const sameLane = (active.extra === true) === extra;
      if (['creating', 'publishing', 'unknown'].includes(active.phase)) {
        if (now() - Date.parse(active.startedAt) < LEASE_MS) return { ok: true, status: 'busy', published: 0 };
        let settled;
        if (!active.containerId) settled = await finish(record, 'failed', { reason: 'container_creation_interrupted' });
        else {
          const container = await request(active.containerId, { fields: 'status_code' });
          if (container.status_code === 'PUBLISHED') settled = await finish(record, 'published', { reconciled: true,
            ...await publishedDetails(active, request) });
          else if (['EXPIRED', 'ERROR'].includes(container.status_code)) settled = await finish(record, 'failed', { reason: 'container_confirmed_unpublished' });
          // FINISHED after an uncertain publish is not permission to publish again.
          else return { ok: false, status: 'review_required', reason: 'publication_unknown', date: active.date,
            id: active.id, publicationConfirmed: false, published: 0 };
        }
        if (extra || active.date === due.day && sameLane) return settled;
      }
      if (record.state.active) {
        if (active.phase !== 'preparing') throw fail('editorial_state_invalid');
        if (active.date !== due.day) await finish(record, 'skipped', { reason: 'past_publication_day' });
        else if (!sameLane) {
          // A stale, unpublished extra container cannot take away the scheduled slot.
          // The same shared CAS lease prevents the displaced invocation from publishing.
          if (!extra && active.extra === true && now() - Date.parse(active.startedAt) >= LEASE_MS)
            await finish(record, 'skipped', {reason:'scheduled_slot_priority'});
          else return {ok:true,status:'busy',published:0};
        }
        else if ((active.baseFingerprint || active.fingerprint) !== hash(JSON.stringify(plan(due.day, extra, active)))) return finish(record, 'skipped', { reason: 'content_changed' });
      }
    }
    if (!record.state.active) {
      const items = extra ? (record.state.extraItems ||= {}) : record.state.items;
      const today = items[due.day];
      if (today?.status === 'published') return { ok: true, status: 'already_published', date: due.day, published: 0,
        ...(today.permalink ? { permalink: today.permalink } : {}) };
      if (today?.attempts >= 3) return { ok: false, status: 'review_required', reason: 'attempt_limit', date: due.day, published: 0 };
      const basePlan = review?.base || plan(due.day, extra);
      if (extra) {
        const limits = await request(env.INSTAGRAM_USER_ID + '/content_publishing_limit', {fields:'quota_usage,config'});
        const limit = limits.data?.[0];
        if (!Array.isArray(limits.data) || limits.data.length !== 1 || !Number.isSafeInteger(limit?.quota_usage) || limit.quota_usage < 0 || !Number.isSafeInteger(limit?.config?.quota_total) || limit.config.quota_total < 1) throw fail('editorial_publishing_limit_invalid');
        const reserve = record.state.items[due.day]?.status === 'published' ? 0 : 1;
        if (limit.config.quota_total - limit.quota_usage <= reserve) return {ok:false,status:'review_required',reason:'editorial_quota_reserved',published:0};
      }
      if (basePlan.format === 'REELS' && Object.values(record.state.items).some(item => item.status === 'published' && item.videoPath === basePlan.videoPath))
        return { ok: true, status: 'video_already_published', date: due.day, published: 0 };
      const recentTopic = basePlan.topicId && Object.entries(items).some(([day, item]) => item.status === 'published' &&
        item.topicId === basePlan.topicId && day < due.day && Date.parse(`${due.day}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) < 30 * DAY_MS);
      if (recentTopic) return { ok: true, status: 'topic_recently_published', date: due.day, published: 0 };
      const post = review?.post || (basePlan.electric ? await draftFor(basePlan) : basePlan);
      if (extra && editorialClock(now()).day !== due.day) throw fail('editorial_review_stale');
      record.state.active = { date: due.day, ...(extra ? {extra:true} : {}), id: post.id, title: post.title, topic: post.topic, topicId: post.topicId,
        format: post.format, version: post.version || EDITORIAL_VERSION, ...electricCopyMetadata(post),
        ...(post.videoPath ? { videoPath: post.videoPath } : {}),
        caption: post.caption, fingerprint: hash(JSON.stringify(post)), attemptId: randomUUID(),
        ...(post.electric ? { baseFingerprint: hash(JSON.stringify(basePlan)), sources: post.sources } : {}),
        attempts: (today?.attempts || 0) + 1, phase: 'creating', createdAt: timestamp(), startedAt: timestamp() };
      try { await save(record); } catch (error) { if (conflict(error)) return { ok: true, status: 'busy', published: 0 }; throw error; }
      try {
        let container;
        if (post.format === 'REELS') {
          container = await request(`${env.INSTAGRAM_USER_ID}/media`, { method: 'POST', body: {
            media_type: 'REELS', video_url: reelUrl(post, env), caption: post.caption,
            ...(reelCoverUrl(post, env) ? { cover_url: reelCoverUrl(post, env) } : {}),
            share_to_feed: 'true', is_ai_generated: 'true',
          } });
        } else {
          const containers = [];
          for (let index = 0; index < post.slides.length; index++) {
            const child = await request(`${env.INSTAGRAM_USER_ID}/media`, { method: 'POST', body: {
              image_url: editorialImageUrl(due.day, index + 1, env, extra, post.version),
              ...(post.slides[index].altText ? { alt_text: String(post.slides[index].altText).slice(0, 1000) } : {}),
              ...(post.format === 'CAROUSEL' ? { is_carousel_item: 'true' } : { caption: post.caption }),
            } });
            if (!numericId(child.id)) throw fail('meta_invalid_container');
            containers.push(String(child.id));
          }
          container = post.format === 'CAROUSEL' ? await request(`${env.INSTAGRAM_USER_ID}/media`, {
            method: 'POST', body: { media_type: 'CAROUSEL', children: containers.join(','), caption: post.caption },
          }) : { id: containers[0] };
        }
        if (!numericId(container.id)) throw fail('meta_invalid_container');
        record.state.active.containerId = String(container.id);
        record.state.active.phase = 'preparing';
        await save(record);
      } catch (error) {
        if (conflict(error)) return { ok: true, status: 'busy', published: 0 };
        return finish(record, 'failed', safeFailure(error));
      }
    }

    let container = await request(record.state.active.containerId, { fields: 'status_code' });
    const polls = Math.max(0, Math.min(3, options.pollAttempts ?? 3));
    for (let poll = 0; container.status_code === 'IN_PROGRESS' && poll < polls && Date.now() + 75_000 < deadline; poll++) {
      await pause(60_000);
      container = await request(record.state.active.containerId, { fields: 'status_code' });
    }
    if (container.status_code === 'PUBLISHED') return finish(record, 'published', { reconciled: true,
      ...await publishedDetails(record.state.active, request) });
    if (container.status_code === 'IN_PROGRESS') return { ok: true, status: 'preparing', date: due.day, published: 0 };
    if (container.status_code !== 'FINISHED') return finish(record, 'failed', { reason: 'container_not_ready' });
    if (Date.now() + 15_000 > deadline) return { ok: true, status: 'preparing', date: due.day, published: 0 };

    // Refresh the state before the irreversible call: a concurrent pause or a
    // changed active attempt invalidates this invocation's permission to publish.
    const current = await read();
    if (!current || !enabled(current.state)) return { ok: true, status: 'disabled', published: 0 };
    if (current.etag !== record.etag || current.state.active?.attemptId !== record.state.active.attemptId)
      return { ok: true, status: 'busy', published: 0 };
    record.state.active.phase = 'publishing'; record.state.active.startedAt = timestamp();
    try { await save(record); } catch (error) { if (conflict(error)) return { ok: true, status: 'busy', published: 0 }; throw error; }
    // Storage and media processing can span midnight. Check after the final
    // awaited lease write so yesterday's item cannot consume today's slot.
    const publicationClock = editorialClock(now());
    if (publicationClock.day !== record.state.active.date || !extra && publicationClock.hour < 19)
      return finish(record, 'skipped', { reason: 'publication_window_closed' });
    let published;
    try {
      published = await request(`${env.INSTAGRAM_USER_ID}/media_publish`, { method: 'POST',
        body: { creation_id: record.state.active.containerId } });
      if (!numericId(published.id)) throw fail('meta_publish_unknown');
    } catch (error) {
      record.state.active.phase = 'unknown';
      record.state[extra ? 'lastExtraResult' : 'lastResult'] = { status: 'publish_unknown', date: due.day, id: record.state.active.id, at: timestamp(), ...safeFailure(error) };
      // If this write fails, the previously persisted 'publishing' phase still
      // blocks every retry. No catch is allowed to turn it into a fresh attempt.
      await save(record);
      return { ok: false, status: 'review_required', reason: 'publication_unknown', date: due.day, published: 0 };
    }
    const details = await publishedDetails(record.state.active, request, published.id);
    return finish(record, 'published', details);
  }
  return { status, calendar, preview, prepareFollowingEdition, extraPreview, validate, postLink, setEnabled, run, configuration: () => configuration };
}
