import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import { editorialPlan, EDITORIAL_TOPIC_COUNT } from '../lib/editorial-content.js';
import { feedEditorialPlan, editorialImageTheme, PREMIUM_REEL_COVER_VARIANT } from '../lib/editorial-simulator.js';
import { renderEditorialImage } from '../lib/editorial-image.js';
import { createEditorialImageHandler } from '../lib/editorial-image-handler.js';
import { editorialImageUrl } from '../lib/instagram-editorial.js';

test('premium rollout changes delivery URLs without changing dated content or archived extra artwork', () => {
  assert.equal(editorialImageTheme('2026-11-25', false, 'v1'), undefined);
  assert.equal(editorialImageTheme('2026-11-26', true, 'v4'), undefined);
  for (const version of ['v1', 'v2', 'v3', 'v4']) {
    assert.equal(editorialImageTheme('2026-11-26', false, version), 'premium1');
    assert.equal(editorialImageTheme('2026-11-27', true, version), 'premium1');
  }
  const env = { INSTAGRAM_PUBLIC_BASE_URL: 'https://autovalorpt-assistente.vercel.app' };
  assert.equal(new URL(editorialImageUrl('2026-11-26', 1, env, false, 'v4')).searchParams.get('theme'), 'premium1');
  assert.equal(new URL(editorialImageUrl('2026-11-26', 1, env, true, 'v4')).searchParams.has('theme'), false);
  const before = JSON.stringify(feedEditorialPlan('2026-11-26'));
  editorialImageUrl('2026-11-26', 1, env, false, 'v4');
  assert.equal(JSON.stringify(feedEditorialPlan('2026-11-26')), before);
});

test('premium, navy and legacy assets have separate cache identities and the portrait cover is limited to approved Reel plans', async () => {
  const seen = [];
  const handler = createEditorialImageHandler({ render: async (...args) => { seen.push(args); return Buffer.from('jpeg'); } });
  async function request(query, headers = {}) {
    const result = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; },
      end(body) { this.body = body; }, json(body) { this.body = body; } };
    await handler({ query, headers, method: 'GET' }, result); return result;
  }
  const query = { date: '2026-11-26', v: 'v4', slide: '1' };
  const old = await request(query), navy = await request({ ...query, theme: 'navy1' }), premium = await request({ ...query, theme: 'premium1' });
  assert.deepEqual([old.code, navy.code, premium.code], [200, 200, 200]);
  assert.equal(new Set([old, navy, premium].map(result => result.headers.ETag)).size, 3);
  assert.equal((await request({ ...query, theme: 'premium1' }, { 'if-none-match': navy.headers.ETag })).code, 200);
  assert.equal(seen.length, 3);
  assert.equal((await request({ ...query, theme: 'premium1' }, { 'if-none-match': premium.headers.ETag })).code, 304);
  assert.equal((await request({ ...query, theme: 'injected' })).code, 400);
  assert.equal((await request({ ...query, theme: 'premium1', variant: PREMIUM_REEL_COVER_VARIANT })).code, 404);
  assert.equal((await request({ date: '2026-11-29', v: 'v1', theme: 'premium1', variant: PREMIUM_REEL_COVER_VARIANT })).code, 200);
  assert.equal((await request({ date: '2026-11-29', v: 'v1', variant: PREMIUM_REEL_COVER_VARIANT })).code, 404);
});

test('every upcoming authored advice card fits premium without truncating assumptions, metrics or tool links', async () => {
  const plans = new Map();
  for (let day = 0; day < 75; day++) {
    const date = new Date(Date.parse('2026-11-26') + day * 86_400_000).toISOString().slice(0, 10);
    for (const extra of [false, true]) {
      const plan = feedEditorialPlan(date, extra);
      if (['v3', 'v4'].includes(plan.version)) plans.set(plan.topicId, plan);
    }
  }
  assert.ok(plans.size > 60);
  for (const plan of plans.values()) {
    const image = await renderEditorialImage(plan, 0, undefined, 'premium1');
    const metadata = await sharp(image).metadata();
    assert.deepEqual([metadata.width, metadata.height, metadata.format], [1080, 1350, 'jpeg'], plan.topicId);
  }
  const reel = editorialPlan('2026-11-29');
  const cover = await renderEditorialImage(reel, 0, PREMIUM_REEL_COVER_VARIANT, 'premium1');
  const { width, height, format } = await sharp(cover).metadata();
  assert.deepEqual([width, height, format], [1080, 1920, 'jpeg']);
  assert.equal(reel.videoPath, '/assets/editorial/test-drive-web-v1.mp4');
  const whatsapp = await renderEditorialImage(feedEditorialPlan('2026-11-26'), 0, 'wa1', 'premium1');
  assert.equal((await sharp(whatsapp).metadata()).height, 1920);
});

test('premium comparison bars preserve the authored ratio and the longest general carousel layouts remain readable', async () => {
  const comparison = await renderEditorialImage(feedEditorialPlan('2026-11-26'), 0, undefined, 'premium1');
  const { data, info } = await sharp(comparison).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  function bar(y, testPixel) {
    let count = 0;
    for (let x = 80; x < 1000; x++) {
      const start = (y * info.width + x) * 3;
      if (testPixel(...data.subarray(start, start + 3))) count++;
    }
    return count;
  }
  const electric = bar(892, (r, g, b) => r > 180 && g > 140 && b < 140);
  const petrol = bar(1012, (r, g, b) => r > 170 && g > 180 && b > 180);
  assert.ok(petrol > 915);
  assert.ok(Math.abs(electric / petrol - 3.96 / 9.90) < .01);
  const representatives = new Map();
  for (let day = 0; day < EDITORIAL_TOPIC_COUNT; day++) {
    const plan = editorialPlan(new Date(Date.parse('2026-11-26') + day * 86_400_000).toISOString().slice(0, 10));
    plan.slides.forEach((slide, index) => {
      const score = slide.title.length * 3 + slide.body.length + (slide.cta || '').length;
      if (!representatives.has(slide.kind) || score > representatives.get(slide.kind).score)
        representatives.set(slide.kind, { plan, index, score });
    });
  }
  for (const { plan, index } of representatives.values())
    await assert.doesNotReject(() => renderEditorialImage(plan, index, undefined, 'premium1'));
});

test('dashboard and sharing previews preserve the explicitly returned historical theme and use premium for new assets', async () => {
  const context = { URL, URLSearchParams, Intl, location: { origin: 'https://autovalorpt-assistente.vercel.app' } };
  runInNewContext(await readFile(new URL('../editorial-preview.js', import.meta.url), 'utf8'), context);
  const { imageUrl } = context.AutoValorEditorialPreview;
  const post = { date: '2026-11-27', version: 'v4' };
  assert.match(imageUrl(post, 0), /theme=premium1&v=v4$/);
  const prefix = '/api/stock?integration=editorial-image&date=2026-11-27&slide=1&v=v4';
  assert.match(imageUrl({ ...post, images: [prefix + '&theme=navy1'] }, 0), /theme=navy1&v=v4$/);
  assert.doesNotMatch(imageUrl({ ...post, images: [prefix] }, 0), /theme=/);
  assert.equal(imageUrl({ ...post, images: [prefix + '&theme=untrusted'] }, 0), null);
});
