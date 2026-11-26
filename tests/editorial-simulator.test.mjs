import assert from 'node:assert/strict';
import test from 'node:test';
import { adviceEditorialPlan } from '../lib/editorial-advice-calendar.js';
import { createEditorialImageHandler } from '../lib/editorial-image-handler.js';
import { captionSuggestion, feedEditorialPlan, withSimulatorAccess } from '../lib/editorial-simulator.js';
import { CREDIT_SIMULATOR_URL, SIMULATOR_URL } from '../lib/electric-editorial-calendar.js';

const day = '2026-11-26';

test('the commute caption names the profile before the fold and carries the costs, assumptions and direct public link', () => {
  const original = adviceEditorialPlan(day, true), updated = feedEditorialPlan(day, true);
  assert.equal(original.version, 'v3');
  assert.equal(updated.version, 'v4');
  assert.equal(updated.feedTool.url, SIMULATOR_URL);
  const lead = updated.caption.split('\n')[0];
  assert.ok(lead.length < 80 && lead.includes('42 km') && lead.includes('link do perfil @autovalorpt'));
  for (const value of ['20 dias', '840 km', '18 kWh/100 km', '0,22 €/kWh', '6 L/100 km', '1,70 €/L',
    '33,26 €', '85,68 €', '52,42 €', SIMULATOR_URL]) assert.ok(updated.caption.includes(value), value);
  assert.equal(updated.caption.split(SIMULATOR_URL).length, 2);
  assert.ok(updated.slides[0].altText.includes(SIMULATOR_URL));
  assert.deepEqual(original, adviceEditorialPlan(day, true));
  const archived = { id: original.id, date: day, extra: true, status: 'published', topicId: original.topicId,
    version: original.version, caption: original.caption };
  const suggested = captionSuggestion(archived);
  assert.equal(suggested.caption, archived.caption);
  assert.equal(suggested.suggestedCaption, updated.caption);
  for (const patch of [{ status: 'unknown' }, { id: 'different' }, { date: '2026-99-88' }, { caption: true }]) {
    const row = { ...archived, ...patch };
    assert.equal(captionSuggestion(row), row);
  }
});

test('the comparison and finance editions link to their own tool while unrelated advice and Reels stay in their original edition', () => {
  const cost = feedEditorialPlan(day), credit = feedEditorialPlan('2027-01-01');
  assert.equal(cost.feedTool.url, SIMULATOR_URL);
  assert.ok(cost.caption.startsWith('Compara o custo por 100 km no link do perfil @autovalorpt.'));
  assert.equal(credit.topicId, 'fatura-energia-prestacao');
  assert.equal(credit.feedTool.url, CREDIT_SIMULATOR_URL);
  assert.ok(credit.caption.startsWith('Simula a tua prestação no link do perfil @autovalorpt.'));
  for (const url of [CREDIT_SIMULATOR_URL, SIMULATOR_URL]) assert.equal(credit.caption.split(url).length, 2);
  for (const other of ['2026-11-25', '2026-11-28', '2026-11-29']) {
    assert.deepEqual(feedEditorialPlan(other), adviceEditorialPlan(other));
  }
  const base = adviceEditorialPlan(day);
  const long = withSimulatorAccess({ ...base, caption: 'a'.repeat(2200), copyOrigin: 'ai', copyModel: 'example' });
  assert.ok(long.caption.length <= 2200 && long.caption.includes(SIMULATOR_URL) && long.caption.includes(base.slides[0].body));
  assert.equal(long.copyOrigin, 'editorial'); assert.equal(long.copyModel, undefined);
});

test('versioned artwork has independent cache validators for daily and extra; historical, mismatched and conditional requests remain safe', async () => {
  const handle = createEditorialImageHandler({ render: async post => Buffer.from(post.id) });
  async function request(v, extra = false, date = day, headers = {}, method = 'GET') {
    const res = { headers: {}, setHeader(k, value) { this.headers[k] = value; }, status(code) { this.code = code; return this; },
      end(data) { this.data = data; }, json(data) { this.data = data; } };
    await handle({ method, headers, query: { date, slide: '1', v, ...(extra ? { extra: '1' } : {}) } }, res);
    return res;
  }
  const old = await request('v3', true), extra = await request('v4', true), daily = await request('v4');
  assert.deepEqual([old.code, extra.code, daily.code], [200, 200, 200]);
  assert.equal(extra.data.toString(), feedEditorialPlan(day, true).id);
  assert.equal(old.data.toString(), adviceEditorialPlan(day, true).id);
  assert.equal(new Set([old, extra, daily].map(res => res.headers.ETag)).size, 3);
  assert.match(extra.headers['Cache-Control'], /immutable/);
  assert.equal((await request('v4', true, day, { 'if-none-match': extra.headers.ETag })).code, 304);
  assert.equal((await request('v4', true, day, { 'if-none-match': old.headers.ETag }, 'HEAD')).code, 200);
  assert.equal((await request('v4', false, '2026-11-29')).code, 404);
});
