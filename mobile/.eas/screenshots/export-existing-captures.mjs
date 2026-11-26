import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { acceptedCaptureSize } from './device-selection.mjs';

const SOURCE_RUN = '01a21992-917c-7681-ab33-863754ef0f2e';
const SOURCE_GIT_COMMIT = '35a7f6acb7956a2d856a3ca4482f8d97f5a9d017';
const PROJECT_ID = '99e2814b-559a-42fe-899b-19b167c1c05c';
const BUILD_ID = 'c678705c-7f83-476a-9a20-d02dee71c36b';
const OUTPUT = '/tmp/autovalorpt-build3-export';
const FILES = ['01-catalogue.png', '02-viatura.png', '03-mais.png'];
const JOBS = {
  iphone: '01a21992-9425-78a2-9ee2-72cc6814cf88',
  ipad: '01a21992-9425-703a-811e-3e182410ead6',
};
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function workflowRun(id) {
  // EAS supplies job authentication. Never read credentials or print raw JSON,
  // which includes signed download URLs. The CLI response has no data wrapper.
  let output;
  try {
    output = execFileSync('npx', ['--yes', 'eas-cli@27.11.0', 'workflow:view', id,
      '--json', '--non-interactive'], { encoding: 'utf8', stdio: 'pipe',
      timeout: 180000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, CI: '1' } });
  } catch {
    throw new Error('EAS CLI could not read the workflow using the job authentication');
  }
  let run;
  try { run = JSON.parse(output); } catch { throw new Error('EAS CLI did not return valid workflow JSON'); }
  assert.equal(run.id, id, 'Unexpected workflow run');
  assert.equal(run.workflow?.app?.id, PROJECT_ID, 'Unexpected Expo project');
  return run;
}

export function selectArchive(run, kind) {
  assert.equal(run.id, SOURCE_RUN, 'Unexpected source run');
  assert.equal(run.gitCommitHash, SOURCE_GIT_COMMIT, 'Unexpected source commit');
  const job = run.jobs.find(item => item.id === JOBS[kind]);
  assert(job && job.key === `capture_${kind}`, `Missing original ${kind} capture job`);
  const archives = (job.artifacts || []).filter(item => /\bMaestro Test Results\b/i.test(item.name || ''));
  assert.equal(archives.length, 1, `Expected one ${kind} Maestro Test Results archive`);
  const artifact = archives[0];
  assert(artifact.downloadUrl && artifact.id, `Missing ${kind} artifact download information`);
  assert(/\.(?:tar\.gz|tgz)$/i.test(artifact.filename || ''), `Expected ${kind} .tar.gz archive`);
  if (artifact.fileSizeBytes) assert(Number(artifact.fileSizeBytes) <= MAX_ARCHIVE_BYTES, 'Archive is unexpectedly large');
  return artifact;
}

export function selectMembers(listing) {
  const members = listing.split('\n').filter(Boolean);
  return FILES.map(name => {
    const matches = members.filter(member => path.posix.basename(member) === name);
    assert.equal(matches.length, 1, `Expected exactly one original ${name}`);
    const member = matches[0];
    assert(!path.posix.isAbsolute(member) && !member.split('/').includes('..') &&
      !/[\\\x00-\x1f\x7f]/.test(member), `Unsafe archive path for ${name}`);
    return { name, member };
  });
}

async function downloadArchive(artifact, kind) {
  let url = new URL(artifact.downloadUrl);
  let response;
  const signal = AbortSignal.timeout(180000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    assert(url.protocol === 'https:' && !url.username && !url.password, 'Unsafe artifact download URL');
    try { response = await fetch(url, { redirect: 'manual', signal }); }
    catch { throw new Error(`Network error downloading the saved ${kind} archive`); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    assert(location && redirects < 5, `Invalid ${kind} archive redirect`);
    await response.body?.cancel();
    url = new URL(location, url);
  }
  assert(response.ok && response.body, `Saved ${kind} archive returned HTTP ${response.status}`);
  const archivePath = path.join(OUTPUT, `${kind}-original.tar.gz`);
  let size = 0;
  const hash = createHash('sha256');
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES) return callback(new Error('Archive exceeded the size limit'));
    hash.update(chunk); callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(archivePath, { flags: 'wx' }));
  if (artifact.fileSizeBytes) assert.equal(size, Number(artifact.fileSizeBytes), `${kind} archive size mismatch`);
  return { archivePath, size, archiveSha256: hash.digest('hex') };
}

async function prepare() {
  assert.equal(process.platform, 'darwin', 'This export uses the macOS sips format converter');
  const source = JSON.parse(await readFile(new URL('./source-build3.json', import.meta.url), 'utf8'));
  const run = workflowRun(SOURCE_RUN);
  await mkdir(OUTPUT, { recursive: false });
  const captures = [];
  for (const kind of Object.keys(JOBS)) {
    const artifact = selectArchive(run, kind);
    console.log(`Reading saved ${kind} Maestro Test Results; artifact ${artifact.id}`);
    const archive = await downloadArchive(artifact, kind);
    const listing = execFileSync('tar', ['-tzf', archive.archivePath],
      { encoding: 'utf8', stdio: 'pipe', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const originals = selectMembers(listing);
    let dimensions;
    for (const { name, member } of originals) {
      // Extract only the chosen regular PNG payload to stdout. No archive entry
      // is allowed to create files, directories or symlinks on the runner.
      const bytes = execFileSync('tar', ['-xOzf', archive.archivePath, '--', member],
        { stdio: 'pipe', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
      assert(bytes.length >= 33 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `Invalid ${kind} ${name} PNG`);
      assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR', 'PNG is missing its image header');
      const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
      assert(acceptedCaptureSize(kind, width, height), `Unexpected ${kind} native dimensions ${width} × ${height}`);
      if (dimensions) assert.deepEqual([width, height], dimensions, 'Inconsistent native capture dimensions');
      dimensions = [width, height];
      const png = `${kind}-${name}`;
      const jpeg = png.replace(/\.png$/, '.jpg');
      const pngPath = path.join(OUTPUT, png); const jpegPath = path.join(OUTPUT, jpeg);
      await writeFile(pngPath, bytes, { flag: 'wx' });
      execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '100', pngPath,
        '--out', jpegPath], { stdio: 'pipe', timeout: 30000 });
      const info = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', jpegPath],
        { encoding: 'utf8', stdio: 'pipe', timeout: 30000 });
      assert.match(info, new RegExp(`pixelWidth: ${width}\\b`));
      assert.match(info, new RegExp(`pixelHeight: ${height}\\b`));
      assert.match(info, /hasAlpha: no\b/);
      const jpegBytes = await readFile(jpegPath);
      assert.equal(jpegBytes.subarray(0, 3).toString('hex'), 'ffd8ff', 'Output is not an actual JPEG');
      captures.push({ kind, png, jpeg, width, height, bytes: jpegBytes.length,
        pngSha256: sha256(bytes), jpegSha256: sha256(jpegBytes),
        sourceJobId: JOBS[kind], sourceArtifactId: artifact.id, archiveSha256: archive.archiveSha256 });
      console.log(`Prepared ${jpeg}: ${width} × ${height}, ${jpegBytes.length} bytes, no alpha`);
    }
  }
  assert.equal(captures.length, 6, 'Expected exactly six authentic screenshots');
  const manifest = { sourceRunId: SOURCE_RUN, sourceRunCommit: SOURCE_GIT_COMMIT,
    sourceCommit: source.sourceCommit, simulatorBuildId: BUILD_ID, testFlightVersion: '1.0.0 (3)',
    processing: 'Original saved Maestro PNGs; JPEG conversion only, no resizing, cropping or synthetic UI',
    exportedAt: new Date().toISOString(), captures };
  await writeFile(path.join(OUTPUT, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Safe capture manifest:', JSON.stringify(manifest));
}

async function verifyUploads() {
  const runId = process.env.EXPORT_RUN_ID;
  assert(runId, 'Missing current export workflow ID');
  const run = workflowRun(runId);
  const job = run.jobs.find(item => item.key === 'export_saved_captures');
  assert(job, 'Current export job not found');
  const manifest = JSON.parse(await readFile(path.join(OUTPUT, 'capture-manifest.json'), 'utf8'));
  for (const capture of manifest.captures) {
    const name = `autovalorpt-build3-${capture.jpeg}`;
    const matches = (job.artifacts || []).filter(item => item.name === name);
    assert.equal(matches.length, 1, `Missing individual JPEG artifact ${name}`);
    const artifact = matches[0];
    assert.equal(artifact.contentType, 'image/jpeg', `${name} was not uploaded as a raw JPEG`);
    assert(/\.jpe?g$/i.test(artifact.filename), `${name} was wrapped in an archive`);
    if (artifact.fileSizeBytes) assert.equal(Number(artifact.fileSizeBytes), capture.bytes, `${name} upload size mismatch`);
    console.log(`Verified raw JPEG artifact: ${name}; id ${artifact.id}; ${capture.width} × ${capture.height}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--verify-uploads') await verifyUploads();
    else { assert.equal(process.argv.length, 2, 'Unexpected export arguments'); await prepare(); }
  } catch (error) {
    // Do not print a stack, command output, signed URLs or any authentication.
    console.error(`Export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
