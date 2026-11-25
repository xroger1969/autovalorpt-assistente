import { createHash } from 'node:crypto';
import { BlobError, BlobNotFoundError } from '@vercel/blob';
import { instagramVideoPath } from './instagram-video-access.js';
import { INSTAGRAM_VIDEO_STYLE } from './instagram-video.js';
import { instagramStorageConflict } from './instagram-storage.js';

const MAX_BYTES = 30 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });

export function assetTimeout(deadline, cap) {
  const ms = Math.min(cap, deadline - Date.now());
  if (ms < 1) throw fail('story_budget_exhausted');
  return AbortSignal.timeout(ms);
}

// Only these values reach the renderer. Both paths use the exact same ordered
// CDN URLs; a legacy row hash alone cannot establish the identity of a gallery.
export function galleryAsset(row, photos) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([INSTAGRAM_VIDEO_STYLE, row.id, row.title, row.description, row.price, photos])).digest('hex');
  return { item: { ...row, image_link: photos[0], image_links: photos },
    fingerprint, path: instagramVideoPath(row.id, fingerprint) };
}

export async function storedVideoSize(storage, path, deadline = Infinity) {
  let meta;
  try { meta = await storage.head(path, { abortSignal: assetTimeout(deadline, 8000) }); }
  catch (error) {
    if (error instanceof BlobNotFoundError || error?.status === 404 || error?.statusCode === 404 || /NotFound/.test(error?.name || '')) return 0;
    throw error;
  }
  if (meta?.contentType !== 'video/mp4' || !Number.isSafeInteger(meta.size) || meta.size < 1000 || meta.size > MAX_BYTES) throw fail('story_asset_invalid');
  return meta.size;
}

export async function saveVideo(storage, path, video, deadline = Infinity) {
  if (!Buffer.isBuffer(video.buffer) || video.buffer.length < 1000 || video.buffer.length > MAX_BYTES ||
      video.width !== 1080 || video.height !== 1920 || video.duration !== 30) throw fail('story_render_invalid');
  try {
    await storage.put(path, video.buffer, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false,
      allowOverwrite: false, cacheControlMaxAge: 60, abortSignal: assetTimeout(deadline, 15000) });
    return { reused: false, bytes: video.buffer.length };
  } catch (error) {
    if (!instagramStorageConflict(error) && error?.constructor !== BlobError) throw error;
    const bytes = await storedVideoSize(storage, path, deadline);
    if (!bytes) throw error;
    return { reused: true, bytes };
  }
}
