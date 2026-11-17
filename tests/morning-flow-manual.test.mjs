import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMorningFlow } from '../lib/morning-flow.js';
import { createMorningFlowHandler } from '../lib/morning-flow-handler.js';
import { memoryBlob } from './helpers/memory-blob.mjs';

const origin = 'https://autovalorpt-assistente.vercel.app';
const cronSecret = 'synthetic-test-only-cron-secret-000000';
function fixture() {
  let now = Date.parse('2026-11-17T16:00:00Z');
  const memory = memoryBlob(), queue = [], operations = [];
  const env = { VERCEL_ENV: 'production', CRON_SECRET: cronSecret };
  const services = {
    source: { audit: async () => { operations.push('source'); return { valid: true, sourceCount: 9, expectedCount: 9 }; } },
    catalog: {
      status: async () => ({ lastResult: { sourceValid: true, expectedCount: 9 } }),
      run: async () => { operations.push('catalog'); return { ok: true, status: 'synced', catalogConfirmed: true }; },
      check: async () => ({ ok: true, status: 'matched', catalogConfirmed: true })
    },
    retirements: { run: async () => { operations.push('retirements'); return { ok: true, status: 'no_retirements', retired: 0, remaining: 0 }; }, status: async () => ({ ok: true }) },
    photo: { run: async () => { operations.push('photo'); return { ok: true, status: 'published', published: 1, id: 'ID8new001' }; }, status: async () => ({ ok: true }) },
    story: { run: async () => { operations.push('story'); return { ok: true, status: 'published', published: 1, id: 'ID8new001' }; }, status: async () => ({ ok: true }) }
  };
  const options = {
    env, services, storage: memory.storage, now: () => now,
    pause: async ms => { now += ms; },
    fetchImpl: async (url, opts) => {
      queue.push({ ...Object.fromEntries(new URL(url).searchParams), url, opts });
      return new Response('{}', { status: 202 });
    }
  };
  const daily = createMorningFlow({ ...options, mode: 'scheduled' });
  const manual = createMorningFlow({ ...options, mode: 'manual' });
  async function start(flow) {
    const result = await flow.start();
    if (result.delivery) await flow.deliver(result.delivery.day, result.delivery.ticket);
    return result;
  }
  async function drain() {
    for (let n = 0; queue.length && n < 100; n++) {
      const entry = queue.shift();
      const flow = entry.mode === 'manual' ? manual : daily;
      if (entry.action === 'delay') await flow.delay(entry.day, entry.ticket);
      else {
        const record = await flow.claim(entry.day, entry.ticket);
        if (record) await flow.execute(record);
      }
    }
    assert.equal(queue.length, 0);
  }
  return { env, options, manual, daily, services, operations, queue, start, drain, setTime: value => { now = Date.parse(value); } };
}

test('on-demand stock run starts after business hours without consuming the scheduled morning record', async () => {
  const f = fixture();
  assert.equal((await f.start(f.daily)).status, 'outside_window');
  assert.equal((await f.start(f.manual)).status, 'queued');
  await f.drain();
  assert.equal((await f.manual.status()).status, 'finished');
  assert.equal((await f.daily.status()).status, 'not_started');
  assert.equal(f.operations.filter(step => step === 'photo').length, 1);
  assert.equal(f.operations.filter(step => step === 'story').length, 1);
});

test('repeated same-day manual taps and delivery callbacks never start an extra publication', async () => {
  const f = fixture();
  await Promise.all([f.start(f.manual), f.start(f.manual), f.start(f.manual)]);
  await f.drain();
  await f.start(f.manual); await f.drain();
  assert.equal(f.operations.filter(step => step === 'photo').length, 1);
  assert.equal(f.operations.filter(step => step === 'story').length, 1);
  assert.equal((await f.manual.status()).status, 'finished');
});

test('manual cycle can publish new stock after the daily publication; scheduled cycle retains its daily limit', async () => {
  const f = fixture();
  f.setTime('2026-11-17T08:00:00Z');
  await f.start(f.daily); await f.drain();
  f.setTime('2026-11-17T16:00:00Z');
  await f.start(f.manual); await f.drain();
  assert.equal((await f.manual.status()).results.photo.status, 'published');
  assert.equal((await f.manual.status()).results.story.status, 'published');
  assert.equal(f.operations.filter(step => step === 'photo').length, 2);
  assert.equal(f.operations.filter(step => step === 'story').length, 2);

  const g = fixture();
  g.setTime('2026-11-17T07:00:00Z');
  await g.start(g.manual); await g.drain();
  g.setTime('2026-11-17T08:00:00Z');
  await g.start(g.daily); await g.drain();
  assert.equal((await g.daily.status()).status, 'finished');
  assert.equal(g.operations.filter(step => step === 'photo').length, 1);
  assert.equal(g.operations.filter(step => step === 'story').length, 1);
});

test('internal callbacks use the fixed production origin and protection bypass stays server-only', async () => {
  const f = fixture();
  const fakeBypass = 'A'.repeat(32);
  f.env.VERCEL_AUTOMATION_BYPASS_SECRET = fakeBypass;
  await f.start(f.manual);
  assert.equal(new URL(f.queue[0].url).origin, origin);
  assert.equal(f.queue[0].opts.headers['x-vercel-protection-bypass'], fakeBypass);
  assert.equal(f.queue[0].opts.headers.Authorization, 'Bearer ' + cronSecret);
  assert.equal(f.queue[0].mode, 'manual');
  assert.equal(JSON.stringify(await f.manual.status()).includes(fakeBypass), false);
});

function response() {
  return { headers: {}, statusCode: 200,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; } };
}

test('manual start requires authenticated same-origin POST and cron callbacks remain secret-only', async () => {
  const f = fixture();
  const pending = [];
  const handler = createMorningFlowHandler({
    ...f.options, authorizeAdmin: req => req.admin === true, waitUntil: work => pending.push(work)
  });
  const invoke = async (query, details = {}) => {
    const res = response();
    await handler({ query, method: 'GET', headers: {}, ...details }, res);
    return res;
  };
  assert.equal((await invoke({ action: 'manual-start' })).statusCode, 401);
  assert.equal((await invoke({ action: 'manual-start' }, { admin: true })).statusCode, 403);
  assert.equal((await invoke({ action: 'manual-start' }, { admin: true, method: 'POST' })).statusCode, 403);
  assert.equal((await invoke({ action: 'manual-start' }, { admin: true, method: 'POST', headers: { origin: 'https://evil.example', host: new URL(origin).host } })).statusCode, 403);
  assert.equal((await invoke({ action: 'manual-start' }, { method: 'POST', headers: { authorization: 'Bearer ' + cronSecret, origin, host: new URL(origin).host } })).statusCode, 403);
  assert.equal((await invoke({ action: 'start', mode: 'manual' }, { admin: true, method: 'POST', headers: { origin, host: new URL(origin).host } })).statusCode, 403);
  assert.equal((await invoke({ action: 'status', mode: 'invalid' }, { admin: true })).statusCode, 400);
  const r = await invoke({ action: 'manual-start' }, { admin: true, method: 'POST', headers: { origin, host: new URL(origin).host } });
  assert.equal(r.statusCode, 202);
  assert.equal(r.body.status, 'queued');
  assert.equal(r.body.delivery, undefined);
  await Promise.all(pending);
  assert.equal(f.queue[0].mode, 'manual');
  assert.equal((await invoke({ action: 'continue', mode: 'manual' }, { admin: true, method: 'POST' })).statusCode, 403);
});

test('iPhone shortcut has its own installable manifest and no embedded access credential', () => {
  const html = readFileSync(new URL('../stock-rapido.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../stock-rapido.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(readFileSync(new URL('../manifest-stock-rapido.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, '/stock-rapido.html');
  assert.equal(manifest.display, 'standalone');
  assert.match(html, /Atualizar agora/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(script, /manual-start/);
  assert.match(script, /method: 'POST'/);
  assert.match(script, /credentials: 'same-origin'/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|Authorization:|innerHTML/);
  const policy = config.headers.find(entry => entry.source === '/stock-rapido.html');
  assert.match(policy.headers.find(h => h.key === 'Content-Security-Policy').value, /frame-ancestors 'none'/);
});


test('expired queued daily step cannot prevent an explicit extra cycle, while a running mutation remains protected', async () => {
  for (const running of [false, true]) {
    const f = fixture();
    f.setTime('2026-11-17T08:00:00Z');
    await f.start(f.daily);
    while (f.queue.length) {
      const entry = f.queue.shift();
      if ((await f.daily.status()).step === 'photo') {
        if (running) await f.daily.claim(entry.day, entry.ticket);
        break;
      }
      const record = await f.daily.claim(entry.day, entry.ticket);
      if (record) await f.daily.execute(record);
    }
    f.setTime('2026-11-17T16:00:00Z');
    await f.start(f.manual); await f.drain();
    assert.equal((await f.manual.status()).results.photo.status, running ? 'other_cycle_in_progress' : 'published');
  }
});

test('coordinator synchronizes authoritative stock before any publication', async () => {
  const f = fixture();
  f.services.source.sync = async () => { f.operations.push('sync'); return { valid: true, sourceCount: 9, expectedCount: 9 }; };
  await f.start(f.manual); await f.drain();
  assert.equal(f.operations[0], 'sync');
  assert.equal(f.operations.includes('source'), false);
});
