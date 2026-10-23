import { adminConfigured } from './admin-security.js';

// Legacy notification links used to carry read/write access. They are retired:
// the archive now requires the same signed, expiring session as the private area.
export function archiveAccessConfigured(env = process.env) {
  return adminConfigured(env);
}

export function createArchiveAccessToken() {
  throw new Error('O arquivo exige uma sessão administrativa. Entre na área privada.');
}

export function verifyArchiveAccessToken() {
  return false;
}

export function archiveAccessLifetimeMs() {
  return 0;
}
