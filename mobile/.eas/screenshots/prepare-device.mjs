import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

assert.equal(process.platform, 'darwin', 'Real iOS screenshots require a macOS simulator runner');
const devices = {
  iphone: { name: 'AutoValorPT Screenshot iPhone', types: ['iPhone 16 Pro'], width: 1206, height: 2622 },
  ipad: { name: 'AutoValorPT Screenshot iPad', types: ['iPad Pro 13-inch (M4)', 'iPad Pro 13-inch (M5)'], width: 2064, height: 2752 },
};
const target = devices[process.env.CAPTURE_DEVICE];
assert(target, 'CAPTURE_DEVICE must be iphone or ipad');
const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
const types = JSON.parse(simctl('list', 'devicetypes', '--json')).devicetypes;
const type = target.types.map(name => types.find(entry => entry.name === name)).find(Boolean);
assert(type, `Required device type unavailable: ${target.types.join(' or ')}`);
const runtimes = JSON.parse(simctl('list', 'runtimes', '--json')).runtimes
  .filter(runtime => runtime.isAvailable && /\.iOS-/.test(runtime.identifier))
  .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
assert(runtimes.length, 'No available iOS runtime');
const runtime = runtimes[0];
const existing = JSON.parse(simctl('list', 'devices', 'available', '--json')).devices[runtime.identifier]
  ?.find(device => device.name === target.name);
if (existing) assert.equal(existing.deviceTypeIdentifier, type.identifier, 'Unexpected existing simulator type');
const udid = existing?.udid ?? simctl('create', target.name, type.identifier, runtime.identifier);
const record = { kind: process.env.CAPTURE_DEVICE, ...target, type: type.name, udid,
  runtime: runtime.identifier, runtimeVersion: runtime.version, createdAt: new Date().toISOString() };
const output = new URL('./output/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('device.json', output), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Prepared ${type.name}: ${udid}; iOS ${runtime.version}; expected ${target.width} × ${target.height}`);
