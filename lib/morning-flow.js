import { randomUUID } from 'node:crypto';
import { get, head, put } from '@vercel/blob';
import { readInstagramBlob, instagramStorageConflict } from './instagram-storage.js';

export const MORNING_STEPS = ['source', 'catalog', 'retirements', 'photo', 'story', 'verify'];
const ORIGIN = 'https://autovalorpt-assistente.vercel.app';
const fail = code => Object.assign(new Error(code), { code });
const safeCode = (value, fallback = 'unknown') => /^[a-z_]{1,70}$/.test(value || '') ? value : fallback;
const validDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day || '');
const safeId = id => /^ID[A-Za-z0-9]{5,30}$/.test(id || '');
const uuid = value => /^[a-f0-9-]{36}$/.test(value || '');
const terminal = state => ['finished', 'blocked', 'interrupted'].includes(state.status);

export function lisbonClock(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Persist only explicit, credential-free result fields, never raw provider errors.
function resultSummary(result = {}) {
  const out = { status: safeCode(result.status), ok: result.ok === true };
  if (result.reason) out.reason = safeCode(result.reason);
  if (safeId(result.id)) out.id = result.id;
  for (const key of ['published', 'retired', 'remaining', 'sourceCount', 'expectedCount', 'actualCount']) {
    if (Number.isSafeInteger(result[key]) && result[key] >= 0) out[key] = result[key];
  }
  for (const key of ['sourceValid', 'catalogConfirmed', 'whatsappVisibilityVerified']) {
    if (typeof result[key] === 'boolean') out[key] = result[key];
  }
  return out;
}

export function createMorningFlow(options = {}) {
  const env = options.env || process.env;
  // Independent daily records: the on-demand button never consumes the 08:00 cycle.
  const mode = options.mode === 'manual' ? 'manual' : 'scheduled';
  const storage = options.storage || { get, head, put };
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || fetch;
  const pause = options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const services = options.services;
  const path = (day, lane = mode) => `morning-flow/v1/production/${lane === 'manual' ? 'manual-' : ''}${day}.json`;
  const timestamp = () => new Date(now()).toISOString();
  const report = options.report || (entry => console.info('morning_flow_result', JSON.stringify(entry)));

  async function read(day, lane = mode) {
    if (!validDay(day) || !['scheduled', 'manual'].includes(lane)) throw fail('invalid_day');
    const blob = await readInstagramBlob(storage, path(day, lane));
    if (!blob) return null;
    if (blob.statusCode !== 200 || !blob.blob?.etag) throw fail('morning_state_unavailable');
    let state;
    try { state = JSON.parse(await new Response(blob.stream).text()); } catch { throw fail('morning_state_invalid'); }
    if (state.version !== 1 || state.day !== day || (state.mode || 'scheduled') !== lane ||
        !MORNING_STEPS.includes(state.step) || !uuid(state.ticket) ||
        !['queued', 'running', 'finished', 'blocked', 'interrupted'].includes(state.status) || !state.results || !state.attempts ||
        !Number.isFinite(Date.parse(state.startedAt))) throw fail('morning_state_invalid');
    return { state, etag: blob.blob.etag };
  }

  async function save(record) {
    const stored = await storage.put(path(record.state.day, record.state.mode || 'scheduled'), JSON.stringify(record.state), {
      access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(record.etag),
      ...(record.etag ? { ifMatch: record.etag } : {}), contentType: 'application/json',
      cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(8000) });
    if (!stored.etag) throw fail('morning_state_unavailable');
    record.etag = stored.etag;
  }

  async function status(day = lisbonClock(now()).day) {
    if (env.VERCEL_ENV !== 'production') return { ok: true, status: 'production_only', steps: MORNING_STEPS };
    const record = await read(day);
    if (!record) return { ok: true, status: 'not_started', day, mode, steps: MORNING_STEPS };
    const state = record.state;
    const stalled = !terminal(state) && now() - Date.parse(state.updatedAt) > 360000;
    return { ok: true, ...state, mode, ...(stalled ? { stalled: true, requiresReview: true } : {}), ticket: undefined,
      whatsappVisibilityVerified: false, whatsappStatus: 'manual_pending' };
  }

  async function latestPrior() {
    const { day } = lisbonClock(now());
    if (env.VERCEL_ENV !== 'production') return { ok: true, status: 'production_only', day };
    const priorDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(day + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() - index - 1);
      return date.toISOString().slice(0, 10);
    });
    let latest = await read(priorDays[0], 'scheduled');
    if (!latest) {
      const older = await Promise.allSettled(priorDays.slice(1).map(priorDay => read(priorDay, 'scheduled')));
      // A read failure before a candidate means it may not be the latest.
      const first = older.find(result => result.status === 'rejected' || result.value);
      if (first?.status === 'rejected') throw first.reason;
      latest = first?.value;
    }
    return { ok: true, day, latest: latest ? { day: latest.state.day, startedAt: latest.state.startedAt } : null };
  }

  async function start() {
    if (env.VERCEL_ENV !== 'production') return { ok: true, status: 'production_only' };
    if (String(env.CRON_SECRET || '').length < 32) throw fail('morning_callback_not_configured');
    const clock = lisbonClock(now());
    if (mode === 'scheduled' && clock.hour !== 8) return { ok: true, status: 'outside_window', day: clock.day };
    let record = await read(clock.day);
    if (record) {
      // A duplicate scheduler event can redeliver only an unclaimed queued step.
      // A running/uncertain mutation is never restarted by the coordinator.
      return { ok: true, status: record.state.status, day: clock.day,
        ...(record.state.status === 'queued' ? { delivery: { day: clock.day, ticket: record.state.ticket } } : {}) };
    }
    record = { etag: null, state: { version: 1, day: clock.day, ...(mode === 'manual' ? { mode } : {}), startedAt: timestamp(), updatedAt: timestamp(),
      status: 'queued', step: 'source', ticket: randomUUID(), attempts: {}, results: {}, waitMs: 0 } };
    try { await save(record); } catch (error) {
      if (instagramStorageConflict(error)) return { ok: true, status: 'already_started', day: clock.day };
      throw error;
    }
    return { ok: true, status: 'queued', day: clock.day, delivery: { day: clock.day, ticket: record.state.ticket } };
  }

  async function deliver(day, ticket, waitMs = 0) {
    if (env.VERCEL_ENV !== 'production' || !validDay(day) || !uuid(ticket) || String(env.CRON_SECRET || '').length < 32) throw fail('invalid_delivery');
    if (options.dispatch) return options.dispatch(day, ticket, waitMs);
    // The destination is fixed. Never send the cron credential to a request Host,
    // arbitrary URL, preview deployment, or redirected origin.
    const url = new URL('/api/stock', ORIGIN);
    url.search = new URLSearchParams({ integration: 'morning-flow', action: waitMs ? 'delay' : 'continue', day, ticket,
      ...(mode === 'manual' ? { mode } : {}) }).toString();
    let responseStatus;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(url.href, { method: 'POST', redirect: 'error',
          headers: { Authorization: `Bearer ${env.CRON_SECRET}`,
            // Only the fixed production callback receives this server-side protection bypass.
            ...(/^[A-Za-z0-9]{32}$/.test(String(env.VERCEL_AUTOMATION_BYPASS_SECRET || ''))
              ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
          signal: AbortSignal.timeout(5000) });
        responseStatus = response.status;
        await response.body?.cancel();
        if (response.ok) return;
      } catch { /* A duplicate delivery is harmless: the ticket is claimed by CAS. */ }
    }
    report({ day, status: 'delivery_unconfirmed', ...(Number.isSafeInteger(responseStatus) ? { responseStatus } : {}) });
    // Keep the queued ticket, allowing a later scheduler event to redeliver it.
  }

  // An external tick may resume only an unclaimed queued ticket. It cannot
  // create a second cycle, replace history or take over an uncertain mutation.
  async function resume() {
    if (env.VERCEL_ENV !== 'production') return { ok: true, status: 'production_only' };
    const day = lisbonClock(now()).day;
    const record = await read(day);
    if (!record) return { ok: true, status: 'not_started', day };
    if (record.state.status !== 'queued') return { ok: true, status: record.state.status, day };
    if (now() - Date.parse(record.state.startedAt) > 3600000)
      return { ok: false, status: 'interrupted', day, reason: 'cycle_window_exceeded' };
    return { ok: true, status: 'queued', day, delivery: { day, ticket: record.state.ticket,
      waitMs: Math.max(0, (record.state.waitMs || 0) - (now() - Date.parse(record.state.updatedAt))) } };
  }

  async function delay(day, ticket) {
    if (env.VERCEL_ENV !== 'production' || !validDay(day) || !uuid(ticket) || day !== lisbonClock(now()).day) return;
    const record = await read(day);
    if (record?.state.status !== 'queued' || record.state.ticket !== ticket) return;
    // Waiting has its own short invocation, leaving the renderer's full budget.
    await pause(30000);
    await deliver(day, ticket);
  }

  async function claim(day, ticket) {
    if (env.VERCEL_ENV !== 'production' || !validDay(day) || !uuid(ticket) || day !== lisbonClock(now()).day) return null;
    const record = await read(day);
    if (!record || record.state.status !== 'queued' || record.state.ticket !== ticket) return null;
    if (now() - Date.parse(record.state.startedAt) > 3600000) {
      record.state.status = 'interrupted'; record.state.updatedAt = timestamp();
      record.state.reason = 'cycle_window_exceeded'; await save(record); return null;
    }
    record.state.status = 'running'; record.state.updatedAt = timestamp();
    record.state.attempts[record.state.step] = (record.state.attempts[record.state.step] || 0) + 1;
    try { await save(record); } catch (error) { if (instagramStorageConflict(error)) return null; throw error; }
    return record;
  }

  async function execute(record) {
    const state = record.state;
    const step = state.step;
    let result; let retry = false;
    try {
      // The scheduled run retains its daily cap. An explicitly requested manual
      // cycle can publish a different new listing; service ledgers deduplicate IDs.
      // Never compete with a running publication. An expired queued callback can
      // no longer claim work (claim enforces the one-hour cycle window).
      if (['photo', 'story'].includes(step)) {
        const other = await read(state.day, mode === 'manual' ? 'scheduled' : 'manual');
        if (mode === 'scheduled' && other?.state.results?.[step]?.published > 0) {
          result = { ok: true, status: 'daily_limit_reached', published: 0 };
        } else if (other && other.state.step === step && (other.state.status === 'running' ||
            other.state.status === 'queued' && now() - Date.parse(other.state.startedAt) <= 3600000)) {
          result = { ok: true, status: 'other_cycle_in_progress', published: 0 };
        }
      }
      if (!result && step === 'source') {
        const previous = await services.catalog.status();
        const syncSource = services.source.sync || services.source.audit;
        const audit = await syncSource({ previousExpectedCount: previous.lastResult?.sourceValid ? previous.lastResult.expectedCount : undefined });
        result = { ok: audit.valid === true, status: audit.valid ? 'source_matches' : 'source_waiting', reason: audit.reason,
          sourceValid: audit.valid === true, sourceCount: audit.sourceCount, expectedCount: audit.expectedCount };
        retry = !audit.valid && state.attempts.source < 30;
        if (!audit.valid && !retry) state.status = 'blocked';
      } else if (!result && step === 'verify') {
        // A read-only destination check follows all mutations, including an import
        // that may still be processing. Visibility in WhatsApp remains explicit.
        const checks = await Promise.allSettled([services.catalog.check(), services.retirements.status(), services.photo.status(), services.story.status()]);
        const names = ['catalog', 'retirements', 'photo', 'story'];
        state.verification = Object.fromEntries(checks.map((check, index) => [names[index], check.status === 'fulfilled' ? {
          ...resultSummary(names[index] === 'retirements' && check.value.configuration?.enabled === false ? { ok: true, status: 'preserved', retired: 0 } : check.value.lastResult || check.value), active: Boolean(check.value.active),
          ...(check.value.counts ? { counts: check.value.counts } : {})
        } : { status: 'unverified', ok: false }]));
        result = { ok: true, status: 'checked', catalogConfirmed: state.verification.catalog.catalogConfirmed === true, whatsappVisibilityVerified: false };
      } else if (!result) {
        const service = services[step];
        if (state.resumeId && ['photo', 'story'].includes(step)) {
          const current = await service.status();
          const active = current.active;
          // Carousel preparation may yield before its parent exists. Only the
          // photo publisher owns these private phases and enforces their leases;
          // a live lease returns busy without issuing another mutation.
          const privateCarousel = step === 'photo' && active?.mediaType === 'CAROUSEL' &&
            ['preparing_children', 'creating_children', 'creating_carousel'].includes(active.phase);
          if (active?.id !== state.resumeId || !(active.phase === 'preparing' || privateCarousel)) {
            // Another actor may have completed it: inspect, never select a second car.
            result = { ok: false, status: 'review_required', reason: 'resume_state_changed', id: state.resumeId };
          }
        }
        if (!result) result = await service.run();
        if (step === 'retirements' && result.ok === true && result.status === 'disabled') result = { ...result, status: 'preserved' };
        if (['photo', 'story'].includes(step) && safeId(result.id) &&
            (result.status === 'preparing' || (result.status === 'busy' && state.resumeId === result.id)) &&
            (!state.resumeId || state.resumeId === result.id)) {
          state.resumeId = result.id;
          retry = state.attempts[step] < 20;
        }
        if (step === 'retirements' && ['retired', 'deferred', 'canceled'].includes(result.status) && result.remaining > 0) retry = state.attempts[step] < 10;
      }
    } catch (error) {
      result = { ok: false, status: 'review_required', reason: safeCode(error?.code, 'step_failed') };
      // An interrupted mutation may already have succeeded remotely. Do not retry.
      if (step === 'source') state.status = 'blocked';
    }
    const previousRetired = state.results[step]?.retired || 0;
    state.results[step] = { ...resultSummary(result), at: timestamp() };
    if (step === 'retirements') state.results[step].retired = previousRetired + (result.retired || 0);
    if (retry) { state.status = 'queued'; state.waitMs = 30000; }
    else if (state.status !== 'blocked') {
      delete state.resumeId;
      const next = MORNING_STEPS[MORNING_STEPS.indexOf(step) + 1];
      state.status = next ? 'queued' : 'finished';
      if (next) state.step = next;
      state.waitMs = 0;
    }
    state.updatedAt = timestamp(); state.ticket = randomUUID();
    // Persist completion before dispatching the next step. If this write fails,
    // the old running claim remains and no mutation is automatically repeated.
    await save(record);
    report({ day: state.day, step, ...resultSummary(result), cycleStatus: state.status });
    if (state.status === 'queued') await deliver(state.day, state.ticket, state.waitMs);
  }

  return { status, latestPrior, start, resume, claim, execute, deliver, delay };
}

