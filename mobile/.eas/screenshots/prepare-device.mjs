import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { candidatePairs, targets } from './device-selection.mjs';

assert.equal(process.platform, 'darwin', 'Real iOS screenshots require a macOS simulator runner');
const kind = process.env.CAPTURE_DEVICE;
const target = targets[kind];
assert(target, 'CAPTURE_DEVICE must be iphone or ipad');
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args],
  { encoding: 'utf8', stdio: 'pipe', timeout: 30000 }).trim();
const types = JSON.parse(simctl('list', 'devicetypes', '--json')).devicetypes;
const runtimes = JSON.parse(simctl('list', 'runtimes', '--json')).runtimes;
const pairs = candidatePairs(kind, types, runtimes);
console.log('Compatible capture candidates:', pairs.map(({ type, runtime }) => `${type.name} / iOS ${runtime.version}`));
assert(pairs.length, `No compatible ${kind} capture device/runtime. Available types: ${types.map(t => t.name).join(', ')}; runtimes: ${runtimes.map(r => `${r.version}:${r.isAvailable}`).join(', ')}`);
const available = JSON.parse(simctl('list', 'devices', 'available', '--json')).devices;
const existing = Object.entries(available).flatMap(([runtime, devices]) =>
  devices.filter(device => device.name === target.name).map(device => ({ ...device, runtime })));
assert(existing.length <= 1, 'Ambiguous existing capture simulator name');
let selected;
const rejected = [];
if (existing.length) {
  const device = existing[0];
  const pair = pairs.find(({ type, runtime }) => runtime.identifier === device.runtime &&
    type.identifier === device.deviceTypeIdentifier);
  assert(pair, 'Existing capture simulator is incompatible; refusing to use another device');
  selected = { ...pair, udid: device.udid };
} else {
  for (const pair of pairs) {
    try {
      const udid = simctl('create', target.name, pair.type.identifier, pair.runtime.identifier);
      assert.match(udid, /^[0-9A-F-]{36}$/i, 'simctl did not return a simulator UUID');
      selected = { ...pair, udid };
      break;
    } catch (error) {
      const detail = String(error.stderr || error.message);
      // Runtime metadata can omit a compatibility restriction. Let CoreSimulator
      // reject that pair, then try the next real, supported capture device.
      if (!/Incompatible device|CoreSimulator\.SimError[^\n]*code[=: ]+403/i.test(detail)) throw error;
      rejected.push({ type: pair.type.name, runtime: pair.runtime.identifier, reason: detail.slice(0, 600) });
      console.warn(`Rejected ${pair.type.name} / iOS ${pair.runtime.version}: incompatible; trying next candidate`);
    }
  }
}
assert(selected, `CoreSimulator rejected every compatible candidate: ${JSON.stringify(rejected)}`);
const { type, runtime, udid } = selected;
const actual = JSON.parse(simctl('list', 'devices', 'available', '--json')).devices[runtime.identifier]
  ?.find(device => device.udid === udid);
assert(actual, 'Created simulator is not available in the selected runtime');
assert.equal(actual.deviceTypeIdentifier, type.identifier, 'Created simulator has a different device type');
const record = { kind, name: target.name, acceptedSizes: target.acceptedSizes,
  type: type.name, typeIdentifier: type.identifier, udid,
  runtime: runtime.identifier, runtimeVersion: runtime.version,
  rejected, createdAt: new Date().toISOString() };
const output = new URL('./output/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('device.json', output), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Prepared ${type.name}: ${udid}; iOS ${runtime.version}; accepted native sizes ${JSON.stringify(target.acceptedSizes)}`);
