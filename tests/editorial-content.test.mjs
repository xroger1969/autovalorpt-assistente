import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { editorialPlan, EDITORIAL_START_DATE, EDITORIAL_TOPIC_COUNT, EDITORIAL_VERSION } from '../lib/editorial-content.js';
import { renderEditorialImage, EDITORIAL_IMAGE_WIDTH, EDITORIAL_IMAGE_HEIGHT } from '../lib/editorial-image.js';

const dateAt = (offset) => new Date(Date.parse(`${EDITORIAL_START_DATE}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const bank = () => Array.from({ length: EDITORIAL_TOPIC_COUNT }, (_, i) => editorialPlan(dateAt(i)));

test('editorial calendar rejects invalid/ambiguous dates and dates before launch', () => {
  for (const value of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-11-31', '2026-11-21T19:00:00Z', '../secret', '', null, ['2026-11-21']]) {
    assert.throws(() => editorialPlan(value), { code: 'editorial_date_invalid' });
  }
  assert.throws(() => editorialPlan('2026-11-20'), { code: 'editorial_date_before_start' });
  assert.equal(editorialPlan('2028-02-29').date, '2028-02-29');
});

test('original bank has at least 35 distinct topics and no repeats in any 30-day window', () => {
  assert.ok(EDITORIAL_TOPIC_COUNT >= 35);
  const plans = bank();
  assert.equal(new Set(plans.map(p => p.topicId)).size, EDITORIAL_TOPIC_COUNT);
  assert.equal(new Set(plans.map(p => p.title)).size, EDITORIAL_TOPIC_COUNT);
  for (let start = 0; start < EDITORIAL_TOPIC_COUNT * 2; start++) {
    const topics = Array.from({ length: 30 }, (_, i) => editorialPlan(dateAt(start + i)).topicId);
    assert.equal(new Set(topics).size, 30);
  }
  assert.deepEqual(editorialPlan(dateAt(0)), editorialPlan(dateAt(0)));
  assert.equal(editorialPlan(dateAt(EDITORIAL_TOPIC_COUNT)).topicId, editorialPlan(dateAt(0)).topicId);
  assert.notEqual(editorialPlan(dateAt(EDITORIAL_TOPIC_COUNT)).id, editorialPlan(dateAt(0)).id);
});

test('every planned post has bounded captions, accessible slides and valid formats', () => {
  const formats = new Set();
  const layouts = new Set();
  for (const plan of bank()) {
    formats.add(plan.format);
    assert.equal(plan.version, EDITORIAL_VERSION);
    assert.ok(plan.caption.length <= 2200 && plan.caption.length > 100);
    assert.ok(plan.slides.length >= 1 && plan.slides.length <= 4);
    assert.equal(plan.format === 'CAROUSEL', plan.slides.length > 1);
    assert.ok(plan.id.includes(plan.date) && plan.id.includes(plan.topicId));
    for (const slide of plan.slides) {
      layouts.add(slide.layout);
      assert.ok(slide.title && slide.body && slide.label);
      assert.ok(slide.altText.length > 50 && slide.altText.length <= 1000);
      assert.ok(!/[<>]/.test(slide.title + slide.body));
    }
  }
  assert.deepEqual(formats, new Set(['IMAGE', 'REELS', 'CAROUSEL']));
  assert.equal(layouts.size, 3);
});

test('callers cannot mutate future plans through a previously returned object', () => {
  const plan = editorialPlan(EDITORIAL_START_DATE);
  const original = structuredClone(plan);
  plan.slides[0].options.push('untrusted option');
  plan.slides[0].title = 'untrusted title';
  assert.deepEqual(editorialPlan(EDITORIAL_START_DATE), original);
});

test('image renderer rejects unknown plans, indices and versions', async () => {
  const plan = editorialPlan(EDITORIAL_START_DATE);
  await assert.rejects(renderEditorialImage({ ...plan, id: 'arbitrary' }), { code: 'editorial_plan_invalid' });
  await assert.rejects(renderEditorialImage({ ...plan, version: 'other' }), { code: 'editorial_plan_invalid' });
  for (const index of [-1, 1, 1.1, '0', Infinity]) await assert.rejects(renderEditorialImage(plan, index), { code: 'editorial_slide_invalid' });
});

test('longest text in each card layout renders fully inside an Instagram-compatible JPEG', async () => {
  const representatives = new Map();
  for (const plan of bank()) {
    plan.slides.forEach((slide, index) => {
      const key = `${slide.kind}-${slide.layout}`;
      const score = slide.title.length * 3 + slide.body.length + (slide.cta || '').length;
      if (!representatives.has(key) || representatives.get(key).score < score) representatives.set(key, { plan, index, score });
    });
  }
  for (const { plan, index } of representatives.values()) {
    const output = await renderEditorialImage(plan, index);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.width, EDITORIAL_IMAGE_WIDTH);
    assert.equal(metadata.height, EDITORIAL_IMAGE_HEIGHT);
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.space, 'srgb');
    assert.ok(output.length > 20_000 && output.length < 8 * 1024 * 1024);
  }
});


test('only the two authorized unpublished Reels override the original calendar', () => {
  const reels = bank().filter(plan => plan.format === 'REELS');
  assert.deepEqual(reels.map(plan => [plan.date, plan.videoPath]), [
    ['2026-11-22', '/assets/editorial/rotina-web-v1.mp4'],
    ['2026-11-29', '/assets/editorial/test-drive-web-v1.mp4'],
  ]);
  for (const plan of reels) {
    assert.equal(plan.aiGenerated, true);
    assert.ok(plan.caption.includes('Imagens ilustrativas criadas com IA.'));
    assert.equal(plan.slides.length, 1);
    assert.ok(!plan.caption.includes('Df9meNfBYmq'));
  }
});
