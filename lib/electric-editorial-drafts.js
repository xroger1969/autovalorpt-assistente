import { randomUUID } from 'node:crypto';
import { BlobError, get, head, put } from '@vercel/blob';
import { instagramStorageConflict } from './instagram-storage.js';

const LEASE_MS = 15000;
const WAIT_MS = [200, 450, 800];
const MAX_READY = 8;
const MAX_BYTES = 32 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const conflict = error => instagramStorageConflict(error) ||
  (error?.constructor === BlobError && /already exists|precondition/i.test(error.message));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function draftFields(value) {
  if (!value || !text(value.caption, 2200) || !Array.isArray(value.sources) || value.sources.length > 8)
    throw fail('editorial_draft_invalid');
  const sources = value.sources.map(source => {
    if (!source || !text(source.label, 240) || !text(source.url, 2048) ||
        source.date !== undefined && (!text(source.date, 40) || !Number.isFinite(Date.parse(source.date))))
      throw fail('editorial_draft_invalid');
    let url;
    try { url = new URL(source.url); } catch { throw fail('editorial_draft_invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || /[\s\u0000-\u001f]/u.test(source.url))
      throw fail('editorial_draft_invalid');
    return { label: source.label, url: source.url, ...(source.date === undefined ? {} : { date: source.date }) };
  });
  return { caption: value.caption, sources };
}

async function readRecord(storage, path, post) {
  const result = await storage.get(path, { access: 'private', useCache: false, headers: { 'Accept-Encoding': 'identity' },
    abortSignal: AbortSignal.timeout(5000) });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.blob?.etag || !result.stream) throw fail('editorial_draft_unavailable');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of result.stream) {
    bytes += chunk.byteLength;
    if (bytes > MAX_BYTES) throw fail('editorial_draft_invalid');
    chunks.push(chunk);
  }
  let record;
  try { record = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('editorial_draft_invalid'); }
  if (record?.version !== 1 || record.id !== post.id || record.date !== post.date) throw fail('editorial_draft_invalid');
  if (record.status === 'ready') return { draft: draftFields(record) };
  if (record.status !== 'preparing' || !text(record.owner, 80) || !Number.isSafeInteger(record.until)) throw fail('editorial_draft_invalid');
  return { owner: record.owner, until: record.until, etag: result.blob.etag };
}

export function createElectricDrafts({ storage = { get, head, put }, namespace, prepare, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(namespace || '') || typeof prepare !== 'function') throw fail('editorial_draft_configuration');
  const inFlight = new Map();
  const ready = new Map();

  async function write(path, value, etag) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw fail('editorial_draft_invalid');
    const result = await storage.put(path, serialized, { access: 'private', contentType: 'application/json',
      addRandomSuffix: false, allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}),
      cacheControlMaxAge: 60, abortSignal: AbortSignal.timeout(5000) });
    if (!result.etag) throw fail('editorial_draft_unavailable');
    return result.etag;
  }

  async function freeze(post) {
    const path = `instagram/editorial/v1/${namespace}/electric-drafts/${post.id}.json`;
    const identity = { version: 1, id: post.id, date: post.date };
    for (let attempt = 0; attempt <= WAIT_MS.length; attempt++) {
      if (attempt) await pause(WAIT_MS[attempt - 1]);
      const saved = await readRecord(storage, path, post);
      if (saved?.draft) return saved.draft;
      if (saved && saved.until > now()) continue;
      let previous;
      if (saved) {
        // Compare the downloaded lease to the strong storage validator before takeover.
        // Finished drafts only need the GET above, without an extra metadata request.
        const meta = await storage.head(path, { abortSignal: AbortSignal.timeout(5000) });
        if (!meta.etag || meta.etag.startsWith('W/') || saved.etag.replace(/^W\//, '') !== meta.etag) continue;
        previous = meta.etag;
      }
      const lease = { ...identity, status: 'preparing', owner: randomUUID(), until: now() + LEASE_MS };
      let claimed;
      try { claimed = await write(path, lease, previous); }
      catch (error) { if (conflict(error)) continue; throw error; }

      const draft = draftFields(await prepare(post));
      const complete = { ...identity, status: 'ready', ...draft };
      try { await write(path, complete, claimed); return draft; }
      catch (error) {
        // A lost acknowledgement can follow a successful commit. Read the exact
        // dated key. A caller that lost its lease must never return its own text.
        const current = await readRecord(storage, path, post);
        if (current?.draft) return current.draft;
        if (!conflict(error) && current?.owner === lease.owner) {
          await write(path, complete, claimed);
          return draft;
        }
        if (!conflict(error)) throw error;
      }
    }
    throw fail('editorial_draft_preparing');
  }

  return async function electricDraft(post) {
    if (!post?.electric) return post;
    const day = Date.parse(post.date);
    if (!text(post.id, 120) || !/^[a-zA-Z0-9_-]+$/.test(post.id) || !/^\d{4}-\d{2}-\d{2}$/.test(post.date || '') ||
        !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== post.date || !post.id.includes(post.date))
      throw fail('editorial_draft_identity_invalid');
    const key = post.date + '/' + post.id;
    let draft = ready.get(key);
    if (!draft) {
      if (!inFlight.has(key)) inFlight.set(key, freeze(post).finally(() => inFlight.delete(key)));
      draft = await inFlight.get(key);
    }
    // Only confirmed, immutable results reach this cache. Refresh recency on each use.
    ready.delete(key);
    ready.set(key, draft);
    if (ready.size > MAX_READY) ready.delete(ready.keys().next().value);
    return { ...post, caption: draft.caption, sources: draft.sources.map(source => ({ ...source })) };
  };
}
