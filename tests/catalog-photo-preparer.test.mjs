import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { catalogBackground, createCatalogPhotoPreparer } from '../lib/catalog-photo-preparer.js';

const source = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#445566' } }).png().toBuffer();
const output = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#778899' } }).png().toBuffer();
const exterior = { kind: 'exterior', confidence: 0.99, one_complete_vehicle: true };
const approved = { same_vehicle: true, all_vehicle_parts_preserved: true, same_plate_and_trim: true,
  clean_edges: true, plausible_ground_contact: true, confidence: 0.99 };
const answer = (value, extra = []) => new Response(JSON.stringify({ status: 'completed',
  output: [{ type: 'message', content: [...extra, { type: 'output_text', text: JSON.stringify(value) }] }] }),
{ headers: { 'Content-Type': 'application/json' } });

function fixture(overrides = {}) {
  const calls = []; const processed = [];
  const options = { env: { OPENAI_API_KEY: 'isolated-test-value' }, loadBackground: async () => output,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, body, signal: init.signal });
      return answer(body.text.format.name === 'catalog_photo_classification' ? exterior : approved);
    },
    processPhoto: async (buffer, settings) => { processed.push({ buffer, settings });
      return { buffer: output, mimeType: 'image/png', width: 100, height: 80 }; }, ...overrides };
  return { prepare: createCatalogPhotoPreparer(options), calls, processed };
}

test('a verified exterior uses the original bytes and two bounded vision checks without image generation', async () => {
  const { prepare, calls, processed } = fixture();
  const result = await prepare({ originalBuffer: source });
  assert.equal(result.status, 'prepared'); assert.equal(result.buffer, output);
  assert.equal(processed[0].buffer, source); assert.equal(processed[0].settings.backgroundBuffer, output);
  assert.equal(calls.length, 2);
  for (const { url, body, signal } of calls) {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
    assert.equal(body.input[1].content.filter(part => part.type === 'input_image').length, 2);
    assert.equal(body.tools, undefined); assert.ok(signal instanceof AbortSignal);
  }
});

test('Samucar scenes and interior details retain the original without composition or a second API call', async () => {
  for (const kind of ['already_samucar', 'interior_or_detail']) {
    let calls = 0;
    const { prepare, processed } = fixture({ fetchImpl: async () => { calls++; return answer({ kind, confidence: 0.99, one_complete_vehicle: false }); } });
    assert.equal((await prepare({ originalBuffer: source })).status, 'unchanged');
    assert.equal(calls, 1); assert.equal(processed.length, 0);
  }
});

test('malformed, uncertain and refused classifications never reach the vehicle processor', async () => {
  for (const [value, extra] of [
    [{ ...exterior, confidence: 2 }, []],
    [{ kind: 'already_samucar', confidence: 0.99 }, []],
    [{ ...exterior, confidence: 0.8 }, []],
    [{ ...exterior, one_complete_vehicle: false }, []],
    [exterior, [{ type: 'refusal', refusal: 'declined' }]],
  ]) {
    const { prepare, processed } = fixture({ fetchImpl: async () => answer(value, extra) });
    assert.equal((await prepare({ originalBuffer: source })).status, 'review_required');
    assert.equal(processed.length, 0);
  }
});

test('an uncertain plate or damaged edge prevents publication of a prepared image', async () => {
  const { prepare } = fixture({ fetchImpl: async (_url, init) => answer(JSON.parse(init.body).text.format.name === 'catalog_photo_classification'
    ? exterior : { ...approved, same_plate_and_trim: false }) });
  const result = await prepare({ originalBuffer: source });
  assert.equal(result.status, 'review_required'); assert.equal(result.reason, 'catalog_photo_visual_review_required');
  assert.equal(result.buffer, undefined);
});

test('one deadline covers a stalled local stage, parent cancellation and late vision results', async () => {
  const stalled = fixture({ loadBackground: () => new Promise(() => {}) });
  assert.equal((await stalled.prepare({ originalBuffer: source, remainingMs: 25 })).reason, 'catalog_photo_budget_exhausted');
  assert.equal(stalled.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await fixture().prepare({ originalBuffer: source, signal: controller.signal })).reason, 'catalog_photo_budget_exhausted');
  let clock = 1000;
  const { prepare } = fixture({ runtimeNow: () => clock, fetchImpl: async (_url, init) => {
    const final = JSON.parse(init.body).text.format.name === 'catalog_photo_review';
    if (final) clock += 45001;
    return answer(final ? approved : exterior);
  } });
  assert.equal((await prepare({ originalBuffer: source })).reason, 'catalog_photo_budget_exhausted');
});

test('missing vision credentials and provider errors expose only a safe review reason', async () => {
  assert.equal((await fixture({ env: {} }).prepare({ originalBuffer: source })).reason, 'catalog_photo_vision_not_configured');
  const { prepare } = fixture({ fetchImpl: async () => { throw new Error('private upstream content'); } });
  const result = await prepare({ originalBuffer: source });
  assert.equal(result.status, 'review_required'); assert.equal(JSON.stringify(result).includes('private upstream'), false);
});

test('the shipped background matches its pinned hash and decodes as the approved landscape scene', async () => {
  const buffer = await catalogBackground(); const metadata = await sharp(buffer).metadata();
  assert.equal(metadata.width, 1200); assert.equal(metadata.height, 900); assert.equal(metadata.format, 'jpeg');
});
