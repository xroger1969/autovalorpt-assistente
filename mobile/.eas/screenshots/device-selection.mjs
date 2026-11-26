// Only device families and native portrait sizes accepted in the required
// App Store Connect screenshot slots. Never substitute or resize a capture.
export const targets = {
  iphone: {
    name: 'AutoValorPT Screenshot iPhone',
    types: ['iPhone 16 Pro', 'iPhone 17 Pro', 'iPhone 17',
      'iPhone 16', 'iPhone 15 Pro', 'iPhone 15', 'iPhone 14 Pro', 'iPhone 18 Pro'],
    acceptedSizes: [[1206, 2622], [1179, 2556]],
  },
  ipad: {
    name: 'AutoValorPT Screenshot iPad',
    types: ['iPad Pro 13-inch (M4)', 'iPad Pro 13-inch (M5)',
      'iPad Air 13-inch (M4)', 'iPad Air 13-inch (M3)', 'iPad Air 13-inch (M2)',
      'iPad Pro (12.9-inch) (6th generation)', 'iPad Pro (12.9-inch) (5th generation)',
      'iPad Pro (12.9-inch) (4th generation)', 'iPad Pro (12.9-inch) (3rd generation)'],
    acceptedSizes: [[2064, 2752], [2048, 2732]],
  },
};

function versionNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || !/^\d+(?:\.\d+){0,2}$/.test(value)) return null;
  if (!value.includes('.')) return Number(value);
  const [major, minor = 0, patch = 0] = value.split('.').map(Number);
  return major * 65536 + minor * 256 + patch;
}

export function compatible(type, runtime) {
  if (!runtime.isAvailable || !/\.iOS-/.test(runtime.identifier)) return false;
  if (Array.isArray(runtime.supportedDeviceTypes)) {
    const supported = runtime.supportedDeviceTypes.some(entry =>
      typeof entry === 'string' ? [type.identifier, type.name].includes(entry) :
        entry.identifier === type.identifier || entry.name === type.name);
    if (!supported) return false;
  }
  const version = versionNumber(runtime.version?.includes('.') ? runtime.version : `${runtime.version}.0`);
  const minimum = versionNumber(type.minRuntimeVersion) ?? versionNumber(type.minRuntimeVersionString);
  const maximum = versionNumber(type.maxRuntimeVersion) ?? versionNumber(type.maxRuntimeVersionString);
  return version !== null && (minimum === null || version >= minimum) &&
    (maximum === null || version <= maximum);
}

export function candidatePairs(kind, types, runtimes) {
  const target = targets[kind];
  if (!target) throw new Error('CAPTURE_DEVICE must be iphone or ipad');
  const orderedRuntimes = [...runtimes].sort((a, b) =>
    String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
  return target.types.flatMap(name => types.filter(type => type.name === name)
    .flatMap(type => orderedRuntimes.filter(runtime => compatible(type, runtime))
      .map(runtime => ({ type, runtime }))));
}

export function acceptedCaptureSize(kind, width, height) {
  return targets[kind]?.acceptedSizes.some(([w, h]) => width === w && height === h) ?? false;
}
