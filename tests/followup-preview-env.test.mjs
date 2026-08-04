import test from 'node:test';
import assert from 'node:assert/strict';

test('Preview tem a chave privada do dry-run configurada sem a expor', () => {
  if (process.env.VERCEL_ENV !== 'preview') return;

  const token = String(process.env.FOLLOWUP_DRY_RUN_TOKEN || '').trim();
  assert.ok(token.length >= 12, 'FOLLOWUP_DRY_RUN_TOKEN não está configurado no ambiente Preview da Vercel.');
});
