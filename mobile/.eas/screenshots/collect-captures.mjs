import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'darwin', 'Capture conversion must run beside the real iOS Simulator');
const output = fileURLToPath(new URL('./output/', import.meta.url));
const device = JSON.parse(await readFile(path.join(output, 'device.json'), 'utf8'));
const source = JSON.parse(await readFile(new URL('./source-build3.json', import.meta.url), 'utf8'));
// EAS documents MAESTRO_TESTS_DIR. The fallback is the same directory used by
// its official maestroTests implementation when the hook does not inherit it.
const testRoot = process.env.MAESTRO_TESTS_DIR || path.join(homedir(), '.maestro', 'tests');
const expected = ['01-catalogue.png', '02-viatura.png', '03-mais.png'];
const found = new Map(expected.map(name => [name, []]));
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(location);
    else if (entry.isFile() && found.has(entry.name)) found.get(entry.name).push(location);
  }
}
await walk(testRoot);
await mkdir(output, { recursive: true });
const captures = [];
for (const name of expected) {
  const candidates = found.get(name);
  assert.equal(candidates.length, 1, `Expected exactly one real Maestro capture ${name}, found ${candidates.length}`);
  const original = candidates[0];
  const bytes = await readFile(original);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `Invalid PNG: ${name}`);
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  assert.equal(width, device.width, `${name}: wrong width; do not resize a different device capture`);
  assert.equal(height, device.height, `${name}: wrong height; do not resize a different device capture`);
  const pngName = `${device.kind}-${name}`;
  const jpegName = pngName.replace(/\.png$/, '.jpg');
  await copyFile(original, path.join(output, pngName));
  // Format conversion only: retain the native pixels, orientation and layout.
  // JPEG has no alpha channel, satisfying App Store screenshot requirements.
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', original,
    '--out', path.join(output, jpegName)], { stdio: 'pipe' });
  const jpegInfo = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', path.join(output, jpegName)], { encoding: 'utf8' });
  assert.match(jpegInfo, new RegExp(`pixelWidth: ${width}\\b`));
  assert.match(jpegInfo, new RegExp(`pixelHeight: ${height}\\b`));
  assert.match(jpegInfo, /hasAlpha: no\b/);
  captures.push({ png: pngName, jpeg: jpegName, width, height,
    pngSha256: createHash('sha256').update(bytes).digest('hex'),
    jpegSha256: createHash('sha256').update(await readFile(path.join(output, jpegName))).digest('hex') });
}
await writeFile(path.join(output, 'capture-manifest.json'), `${JSON.stringify({
  sourceCommit: source.sourceCommit, testFlightVersion: '1.0.0 (3)',
  simulatorBuildId: process.env.CAPTURE_BUILD_ID || null,
  capturedAt: new Date().toISOString(), device, captures,
  method: 'Native iOS Simulator running unchanged application sources; Maestro takeScreenshot',
  processing: 'JPEG format conversion only; no resizing, cropping, replacement, retouching or synthetic UI',
  review: 'Human visual review is still required before uploading to App Store Connect',
}, null, 2)}\n`);
console.log(`Prepared ${captures.length} native ${device.kind} captures at ${device.width} × ${device.height}`);
