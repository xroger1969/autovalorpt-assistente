import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createCatalogPhotoProcessor } from '../lib/catalog-photo-processor.js';

function rectangleMask(width = 64, height = 64, rectangle = [10, 10, 54, 54]) {
  const data = new Float32Array(width * height);
  const [left, top, right, bottom] = rectangle;
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) data[y * width + x] = 1;
  return { width, height, data };
}

async function photo(width = 160, height = 120) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    data[i] = (x * 3 + y) % 256; data[i + 1] = (x + y * 5) % 256; data[i + 2] = (x * 2 + y * 7) % 256;
  }
  return { data, buffer: await sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer() };
}

async function backdrop() {
  return await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 7, g: 19, b: 43 } } }).png().toBuffer();
}

test('every opaque foreground pixel retains the original RGB, including enclosed glass and wheel regions', async () => {
  const original = await photo(); const mask = rectangleMask();
  // An enclosed low-saliency region must not turn a real vehicle detail into background.
  for (let y = 24; y < 36; y++) for (let x = 24; x < 36; x++) mask.data[y * mask.width + x] = 0;
  const process = createCatalogPhotoProcessor({ predict: async (rgb, width, height) => {
    assert.equal(width, 160); assert.equal(height, 120); assert.deepEqual(rgb, original.data);
    return mask;
  } });
  const result = await process(original.buffer, { backgroundBuffer: await backdrop() });
  const output = await sharp(result.buffer).removeAlpha().raw().toBuffer();
  const alpha = await sharp(result.maskBuffer).greyscale().raw().toBuffer();
  let opaque = 0; let softEdge = 0;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 255) {
      assert.deepEqual(output.subarray(i * 3, i * 3 + 3), original.data.subarray(i * 3, i * 3 + 3)); opaque++;
    } else if (alpha[i] > 0) softEdge++;
  }
  assert.ok(opaque > 5000); assert.ok(softEdge > 0);
  assert.equal(alpha[60 * 160 + 80], 255);
  assert.deepEqual([...output.subarray(0, 3)], [7, 19, 43]);
  assert.equal(result.mimeType, 'image/png'); assert.equal((await sharp(result.buffer).metadata()).format, 'png');
  assert.equal(result.width, 160); assert.equal(result.height, 120);
  assert.equal(result.quality.opaquePixels, opaque); assert.equal(result.quality.syntheticShadow, true);
  assert.equal(result.quality.shadowMode, 'lower-mask-contact');
  assert.ok(result.quality.shadowPeakOpacity < 0.2);
  // A contact shadow is below the car; it must not add a halo above the roof.
  assert.deepEqual([...output.subarray((10 * 160 + 80) * 3, (10 * 160 + 80) * 3 + 3)], [7, 19, 43]);
  const below = (104 * 160 + 80) * 3;
  assert.ok(output[below + 2] < 43);
});

test('a non-4:3 photograph is padded without resampling the original foreground', async () => {
  const original = await photo(160, 100);
  const process = createCatalogPhotoProcessor({ predict: async () => rectangleMask() });
  const result = await process(original.buffer, { backgroundBuffer: await backdrop() });
  const output = await sharp(result.buffer).removeAlpha().raw().toBuffer();
  assert.equal(result.width, 160); assert.equal(result.height, 120);
  assert.deepEqual(result.quality.originalOffset, { left: 0, top: 10 });
  const originalPixel = (50 * 160 + 80) * 3;
  const outputPixel = (60 * 160 + 80) * 3;
  assert.deepEqual(output.subarray(outputPixel, outputPixel + 3), original.data.subarray(originalPixel, originalPixel + 3));
});

test('EXIF orientation is applied consistently to the source and predicted mask', async () => {
  const original = await photo(120, 160);
  const rotatedSource = await sharp(original.buffer).withMetadata({ orientation: 6 }).jpeg({ quality: 100 }).toBuffer();
  const expected = await sharp(rotatedSource).rotate().toColorspace('srgb').removeAlpha().raw().toBuffer();
  const process = createCatalogPhotoProcessor({ predict: async (rgb, width, height) => {
    assert.equal(width, 160); assert.equal(height, 120); assert.deepEqual(rgb, expected);
    return rectangleMask();
  } });
  const result = await process(rotatedSource, { backgroundBuffer: await backdrop() });
  assert.equal(result.width, 160); assert.equal(result.height, 120);
  const output = await sharp(result.buffer).removeAlpha().raw().toBuffer();
  const pixel = (60 * 160 + 80) * 3;
  assert.deepEqual(output.subarray(pixel, pixel + 3), expected.subarray(pixel, pixel + 3));
});

test('empty, whole-image, clipped and disconnected masks remain rejected even with allowUncertain', async () => {
  const original = await photo(); const backgroundBuffer = await backdrop();
  const whole = rectangleMask(64, 64, [0, 0, 64, 64]); whole.data[30 * 64 + 30] = 0;
  const disconnected = rectangleMask(64, 64, [5, 12, 25, 52]);
  for (let y = 12; y < 52; y++) for (let x = 39; x < 59; x++) disconnected.data[y * 64 + x] = 1;
  for (const mask of [
    { width: 64, height: 64, data: new Float32Array(64 * 64) },
    { width: 64, height: 64, data: new Float32Array(64 * 64).fill(1) },
    whole, rectangleMask(64, 64, [0, 12, 45, 52]), disconnected,
    rectangleMask(64, 64, [24, 24, 29, 29]),
  ]) {
    const process = createCatalogPhotoProcessor({ predict: async () => mask });
    await assert.rejects(process(original.buffer, { backgroundBuffer, allowUncertain: true }), { code: 'catalog_photo_mask_unusable' });
  }
});

test('uncertain geometry fails closed by default and reports the precise warning for manual QA', async () => {
  const original = await photo(); const backgroundBuffer = await backdrop();
  const process = createCatalogPhotoProcessor({ predict: async () => rectangleMask(128, 128, [1, 20, 96, 112]) });
  await assert.rejects(process(original.buffer, { backgroundBuffer }), error => {
    assert.equal(error.code, 'catalog_photo_mask_uncertain');
    assert.ok(error.quality.warnings.includes('subject_near_border'));
    return true;
  });
  await assert.rejects(process(original.buffer, { backgroundBuffer, allowUncertain: 'true' }), { code: 'catalog_photo_mask_uncertain' });
  const result = await process(original.buffer, { backgroundBuffer, allowUncertain: true });
  assert.equal(result.quality.uncertain, true); assert.equal(result.quality.accepted, true);
});

test('malformed model output and invalid image inputs never produce a usable composition', async () => {
  const original = await photo(); const backgroundBuffer = await backdrop();
  const nan = rectangleMask(); nan.data[3] = NaN;
  for (const mask of [nan, { width: 64, height: 64, data: new Float32Array(10) }]) {
    const process = createCatalogPhotoProcessor({ predict: async () => mask });
    await assert.rejects(process(original.buffer, { backgroundBuffer }), { code: 'catalog_photo_mask_invalid' });
  }
  let predictions = 0;
  const process = createCatalogPhotoProcessor({ predict: async () => { predictions++; return rectangleMask(); } });
  await assert.rejects(process(original.buffer), { code: 'catalog_photo_background_missing' });
  await assert.rejects(process(Buffer.from('not an image'), { backgroundBuffer }), { code: 'catalog_photo_invalid_input' });
  assert.equal(predictions, 0);
  await assert.rejects(process(original.buffer, { backgroundBuffer: Buffer.from('invalid backdrop') }), { code: 'catalog_photo_background_invalid' });
});

test('aborting a caller never releases the inference lock while its prediction is still running', async () => {
  const original = await photo(); const backgroundBuffer = await backdrop();
  let releaseFirst; let announceFirst; let calls = 0; let active = 0; let maximumActive = 0;
  const firstStarted = new Promise(resolve => { announceFirst = resolve; });
  const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
  const process = createCatalogPhotoProcessor({ predict: async () => {
    const call = ++calls; active++; maximumActive = Math.max(maximumActive, active);
    if (call === 1) { announceFirst(); await firstHeld; }
    active--;
    return rectangleMask();
  } });
  const controller = new AbortController();
  const first = process(original.buffer, { backgroundBuffer, signal: controller.signal });
  const firstRejected = assert.rejects(first, { code: 'catalog_photo_processing_aborted' });
  await firstStarted;
  controller.abort();
  await firstRejected;
  const next = process(original.buffer, { backgroundBuffer });
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 1); assert.equal(active, 1);
  } finally { releaseFirst(); }
  const result = await next;
  assert.equal(result.quality.accepted, true); assert.equal(calls, 2); assert.equal(maximumActive, 1);
});

test('expired and cancelled queue entries never start a later inference', async () => {
  const original = await photo(); const backgroundBuffer = await backdrop();
  let releaseFirst; let announceFirst; let calls = 0;
  const firstStarted = new Promise(resolve => { announceFirst = resolve; });
  const firstHeld = new Promise(resolve => { releaseFirst = resolve; });
  const process = createCatalogPhotoProcessor({ predict: async () => {
    calls++;
    if (calls === 1) { announceFirst(); await firstHeld; }
    return rectangleMask();
  } });
  await assert.rejects(process(original.buffer, { backgroundBuffer, remainingMs: 0 }), { code: 'catalog_photo_deadline_exceeded' });
  assert.equal(calls, 0);
  const first = process(original.buffer, { backgroundBuffer });
  await firstStarted;
  try {
    await assert.rejects(process(original.buffer, { backgroundBuffer, remainingMs: 20 }), { code: 'catalog_photo_deadline_exceeded' });
  } finally { releaseFirst(); }
  await first;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1);
});
