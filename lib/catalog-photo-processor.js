import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// U2NetP predicts only an alpha mask. The visible vehicle always comes from the
// original decoded photograph. See assets/models/README.md for model provenance.
export const CATALOG_PHOTO_MODEL = Object.freeze({
  id: 'u2netp',
  version: 'rembg-v0.0.0',
  sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  width: 320,
  height: 320,
});
export const CATALOG_PHOTO_PROCESSOR_VERSION = 'u2netp-original-rgb-v1';

const MODEL_FILE = new URL('../assets/models/u2netp.onnx', import.meta.url);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const MAX_PROCESSING_MS = 45_000;
const fail = (code, quality) => Object.assign(new Error(code), { code, ...(quality ? { quality } : {}) });
let sessionPromise;
let inferenceQueue = Promise.resolve();

function checkActive({ signal, deadlineAt }) {
  if (signal?.aborted) throw fail('catalog_photo_processing_aborted');
  if (Date.now() >= deadlineAt) throw fail('catalog_photo_deadline_exceeded');
}

function waitWithinDeadline(task, { signal, deadlineAt }) {
  // This only stops the caller waiting. In particular it must not settle the
  // inference queue or pretend that synchronous WASM execution was interrupted.
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { cleanup(); reject(fail('catalog_photo_processing_aborted')); };
    timer = setTimeout(() => { cleanup(); reject(fail('catalog_photo_deadline_exceeded')); }, Math.max(0, deadlineAt - Date.now()));
    signal?.addEventListener('abort', onAbort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) onAbort();
  });
}

function queuedPrediction(predict, original, context) {
  const pending = inferenceQueue.then(async () => {
    checkActive(context);
    const mask = await predict(original.rgb, original.width, original.height, context);
    checkActive(context);
    return mask;
  });
  // Tie the lock to actual execution, not to waitWithinDeadline's early return.
  inferenceQueue = pending.catch(() => {});
  return pending;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let model;
      try { model = await readFile(MODEL_FILE); } catch { throw fail('catalog_photo_model_unavailable'); }
      if (createHash('sha256').update(model).digest('hex') !== CATALOG_PHOTO_MODEL.sha256) {
        throw fail('catalog_photo_model_integrity');
      }
      const ort = await import('onnxruntime-web');
      // Node supports the single-threaded WASM provider. Resolve both artifacts
      // locally; processing a request must never fetch executable code or models.
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.initTimeout = 20_000;
      ort.env.wasm.wasmPaths = {
        mjs: import.meta.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs'),
        wasm: fileURLToPath(import.meta.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')),
      };
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      return { ort, session };
    })().catch(error => { sessionPromise = undefined; throw error; });
  }
  return sessionPromise;
}

async function predictMask(rgb, width, height, context) {
  const { ort, session } = await getSession();
  checkActive(context);
  const pixels = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(320, 320, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).raw().toBuffer();
  checkActive(context);
  let maximum = 0;
  for (const value of pixels) maximum = Math.max(maximum, value);
  maximum = Math.max(maximum, 1e-6);
  const input = new Float32Array(3 * 320 * 320);
  const mean = [0.485, 0.456, 0.406];
  const deviation = [0.229, 0.224, 0.225];
  // Adapted from rembg BaseSession.normalize (MIT); retain its max-value
  // normalisation, NCHW order and channel constants for these specific weights.
  for (let i = 0; i < 320 * 320; i++) {
    for (let channel = 0; channel < 3; channel++) {
      input[channel * 320 * 320 + i] = (pixels[i * 3 + channel] / maximum - mean[channel]) / deviation[channel];
    }
  }
  const tensor = new ort.Tensor('float32', input, [1, 3, 320, 320]);
  let outputs;
  try {
    checkActive(context);
    outputs = await session.run({ [session.inputNames[0]]: tensor });
    checkActive(context);
    const output = outputs[session.outputNames[0]];
    if (!output || output.data.length !== 320 * 320) throw fail('catalog_photo_mask_invalid');
    return { data: Float32Array.from(output.data), width: 320, height: 320 };
  } finally {
    tensor.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
}

function maskComponents(mask, width, height) {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largestLabel = 0; let largestSize = 0; let components = 0; let total = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = ++components;
    let head = 0; let tail = 1;
    queue[0] = start; labels[start] = label;
    while (head < tail) {
      const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && mask[next] && !labels[next]) { labels[next] = label; queue[tail++] = next; }
      }
    }
    total += tail;
    if (tail > largestSize) { largestLabel = label; largestSize = tail; }
  }
  return { labels, largestLabel, largestSize, total, components };
}

function solidSilhouette(labels, largestLabel, width, height) {
  const silhouette = Buffer.alloc(labels.length);
  if (!largestLabel) return silhouette;
  const outside = new Uint8Array(labels.length);
  const queue = new Int32Array(labels.length);
  let head = 0; let tail = 0;
  const visit = index => {
    if (!outside[index] && labels[index] !== largestLabel) { outside[index] = 1; queue[tail++] = index; }
  };
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }
  // Keep the vehicle interior fully opaque, including its real glass, reflections
  // and wheel details. No generative reconstruction or colour correction occurs.
  for (let i = 0; i < silhouette.length; i++) silhouette[i] = outside[i] ? 0 : 255;
  return silhouette;
}

function assessMask(mask) {
  const width = mask?.width; const height = mask?.height; const values = mask?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 ||
    width * height > 1_000_000 || !values || values.length !== width * height) throw fail('catalog_photo_mask_invalid');
  let minimum = Infinity; let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) throw fail('catalog_photo_mask_invalid');
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  if (maximum - minimum < 0.00001) throw fail('catalog_photo_mask_unusable');
  const binary = new Uint8Array(values.length);
  const probabilities = Buffer.alloc(values.length);
  let uncertainPixels = 0;
  for (let i = 0; i < values.length; i++) {
    const value = (values[i] - minimum) / (maximum - minimum);
    binary[i] = value >= 0.5 ? 1 : 0;
    probabilities[i] = Math.round(value * 255);
    if (value > 0.1 && value < 0.9) uncertainPixels++;
  }
  const components = maskComponents(binary, width, height);
  const silhouette = solidSilhouette(components.labels, components.largestLabel, width, height);
  let left = width; let right = -1; let top = height; let bottom = -1; let count = 0;
  for (let i = 0; i < silhouette.length; i++) {
    if (!silhouette[i]) continue;
    const x = i % width; const y = Math.floor(i / width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
  }
  const coverage = count / silhouette.length;
  const largestComponentFraction = components.total ? components.largestSize / components.total : 0;
  const touchesBorder = left <= 0 || top <= 0 || right >= width - 1 || bottom >= height - 1;
  const bounds = { left: left / width, top: top / height, right: (right + 1) / width, bottom: (bottom + 1) / height };
  const quality = {
    model: CATALOG_PHOTO_MODEL.id,
    processorVersion: CATALOG_PHOTO_PROCESSOR_VERSION,
    modelVersion: CATALOG_PHOTO_MODEL.version,
    modelSha256: CATALOG_PHOTO_MODEL.sha256,
    maskWidth: width, maskHeight: height, coverage, normalizedBounds: bounds,
    touchesBorder, components: components.components, largestComponentFraction,
    uncertainFraction: uncertainPixels / silhouette.length,
    warnings: [],
  };
  // These conditions are never bypassed, including during manual uncertain-mask QA.
  if (!count || coverage < 0.07 || coverage > 0.82 || touchesBorder || largestComponentFraction < 0.9) {
    throw fail('catalog_photo_mask_unusable', quality);
  }
  const boundsWidth = bounds.right - bounds.left; const boundsHeight = bounds.bottom - bounds.top;
  if (boundsWidth < 0.3 || boundsHeight < 0.25 || boundsWidth / boundsHeight < 0.7 || boundsWidth / boundsHeight > 4) {
    quality.warnings.push('unexpected_subject_shape');
  }
  if (largestComponentFraction < 0.98) quality.warnings.push('separate_foreground_regions');
  if (quality.uncertainFraction > 0.18) quality.warnings.push('broad_uncertain_boundary');
  if (Math.min(bounds.left, bounds.top, 1 - bounds.right, 1 - bounds.bottom) < 0.015) {
    quality.warnings.push('subject_near_border');
  }
  quality.uncertain = quality.warnings.length > 0;
  // Preserve the model's sub-pixel contour information only at the outer edge.
  // Hard thresholding before enlargement would turn curved bodywork into stairs.
  // Keep the complete interior opaque and suppress disconnected background spots.
  const softSilhouette = Buffer.from(silhouette);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    let foregroundNeighbours = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (silhouette[i + dy * width + dx]) foregroundNeighbours++;
    }
    if (foregroundNeighbours > 0 && foregroundNeighbours < 9) {
      softSilhouette[i] = silhouette[i] && !binary[i] ? 255 : probabilities[i];
    }
  }
  return { silhouette: softSilhouette, width, height, quality };
}

async function decodeOriginal(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw fail('catalog_photo_invalid_input');
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false });
    const metadata = await image.metadata();
    if ((metadata.pages || 1) > 1) throw new Error('Animated image');
    const result = await image.rotate().toColorspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (result.info.width < 64 || result.info.height < 64 || result.info.channels !== 3) throw new Error('Invalid dimensions');
    return { rgb: result.data, width: result.info.width, height: result.info.height };
  } catch { throw fail('catalog_photo_invalid_input'); }
}

async function contactShadow(alpha, width, height, bounds) {
  const seed = Buffer.alloc(alpha.length);
  const subjectHeight = (bounds.bottom - bounds.top) * height;
  const lowestAllowed = (bounds.top + (bounds.bottom - bounds.top) * 0.5) * height;
  const depth = Math.max(2, Math.round(height / 125));
  let columns = 0;
  for (let x = 0; x < width; x++) {
    let top = height; let bottom = -1;
    for (let y = 0; y < height; y++) if (alpha[y * width + x] >= 192) { top = Math.min(top, y); bottom = y; }
    // A mirror/antenna protrusion has no tall body column underneath it. Do not
    // cast a detached shadow from such a detail or from any upper contour.
    if (bottom < lowestAllowed || bottom - top < subjectHeight * 0.2) continue;
    columns++;
    for (let y = bottom; y <= Math.min(height - 1, bottom + depth); y++) seed[y * width + x] = 55;
  }
  if (!columns) return { rgba: null, peakOpacity: 0 };
  const blurred = await sharp(seed, { raw: { width, height, channels: 1 } })
    .blur(Math.max(0.8, Math.min(6, height / 150))).greyscale().raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  let peak = 0;
  for (let i = 0; i < blurred.length; i++) {
    const opacity = Math.min(32, blurred[i]);
    rgba[i * 4 + 3] = opacity; peak = Math.max(peak, opacity);
  }
  return { rgba, peakOpacity: peak / 255 };
}

// The injectable predictor is only a server-side test seam. The exported default
// below always uses the pinned local U2NetP weights; HTTP callers do not select it.
export function createCatalogPhotoProcessor({ predict = predictMask } = {}) {
  return async function process(originalBuffer, { backgroundBuffer, allowUncertain = false, signal, deadlineAt, remainingMs } = {}) {
    const now = Date.now();
    const context = {
      signal,
      deadlineAt: Math.min(now + MAX_PROCESSING_MS,
        Number.isFinite(deadlineAt) ? deadlineAt : Infinity,
        Number.isFinite(remainingMs) ? now + Math.max(0, remainingMs) : Infinity),
    };
    checkActive(context);
    const task = (async () => {
      if (!Buffer.isBuffer(backgroundBuffer) || !backgroundBuffer.length || backgroundBuffer.length > MAX_BYTES) {
        throw fail('catalog_photo_background_missing');
      }
      const original = await decodeOriginal(originalBuffer);
      checkActive(context);
      const assessed = assessMask(await queuedPrediction(predict, original, context));
      if (assessed.quality.uncertain && allowUncertain !== true) throw fail('catalog_photo_mask_uncertain', assessed.quality);

      // Resize only the mask and background. For non-4:3 sources, extend the canvas
      // symmetrically to 4:3 without cropping, resizing or shifting parts of the car.
      const unit = Math.ceil(Math.max(original.width / 4, original.height / 3));
      const width = unit * 4; const height = unit * 3;
      if (width * height > MAX_PIXELS) throw fail('catalog_photo_invalid_input');
      const offset = { left: Math.floor((width - original.width) / 2), top: Math.floor((height - original.height) / 2) };
      const alpha = await sharp(assessed.silhouette, { raw: { width: assessed.width, height: assessed.height, channels: 1 } })
        .resize(original.width, original.height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
        .blur(0.3).greyscale().raw().toBuffer();
      checkActive(context);
      const rgba = Buffer.alloc(original.width * original.height * 4);
      let opaquePixels = 0; let edgePixels = 0;
      for (let i = 0; i < alpha.length; i++) {
        const position = Math.max(0, Math.min(1, (alpha[i] - 64) / 127));
        const value = Math.round(255 * position * position * (3 - 2 * position));
        alpha[i] = value;
        original.rgb.copy(rgba, i * 4, i * 3, i * 3 + 3); rgba[i * 4 + 3] = value;
        if (value === 255) opaquePixels++;
        else if (value > 0) edgePixels++;
      }
      const shadow = await contactShadow(alpha, original.width, original.height, assessed.quality.normalizedBounds);
      checkActive(context);
      let backdrop;
      try {
        backdrop = await sharp(backgroundBuffer, { limitInputPixels: MAX_PIXELS, failOn: 'error', animated: false })
          .rotate().resize(width, height, { fit: 'fill' }).toColorspace('srgb').removeAlpha().png().toBuffer();
      } catch { throw fail('catalog_photo_background_invalid'); }
      checkActive(context);
      const raw = { width: original.width, height: original.height, channels: 4 };
      const layers = shadow.rgba ? [{ input: shadow.rgba, raw, ...offset, blend: 'over' }] : [];
      layers.push({ input: rgba, raw, ...offset, blend: 'over' });
      const buffer = await sharp(backdrop).composite(layers).removeAlpha().png().toBuffer();
      checkActive(context);
      const maskBuffer = await sharp(alpha, { raw: { width: original.width, height: original.height, channels: 1 } }).png().toBuffer();
      checkActive(context);
      const normalized = assessed.quality.normalizedBounds;
      const bounds = {
        left: Math.floor(normalized.left * original.width) + offset.left,
        top: Math.floor(normalized.top * original.height) + offset.top,
        right: Math.ceil(normalized.right * original.width) + offset.left,
        bottom: Math.ceil(normalized.bottom * original.height) + offset.top,
      };
      return {
        buffer, maskBuffer, mimeType: 'image/png', width, height,
        quality: {
          ...assessed.quality, bounds, originalWidth: original.width, originalHeight: original.height,
          originalOffset: offset, opaquePixels, edgePixels, syntheticShadow: Boolean(shadow.rgba),
          shadowMode: shadow.rgba ? 'lower-mask-contact' : 'none', shadowPeakOpacity: shadow.peakOpacity,
          preservesOriginalRgb: true, accepted: true,
        },
      };
    })();
    return await waitWithinDeadline(task, context);
  };
}

export const processCatalogPhoto = createCatalogPhotoProcessor();
