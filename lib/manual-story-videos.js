import { head, put } from '@vercel/blob';
import { readStockInventories } from './meta-catalog-source.js';
import { stockFeedRow } from './stock-source.js';
import { instagramVideoAccessConfigured, signInstagramVideoUrl } from './instagram-video-access.js';
import { renderInstagramVideo } from './instagram-video.js';
import { galleryAsset, storedVideoSize, saveVideo } from './instagram-story-asset.js';

const idPattern = /^ID[A-Za-z0-9]{5,30}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const fail = code => Object.assign(new Error(code), { code });

export function createManualStoryVideos(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const fetchImpl = options.fetchImpl || fetch;
  const storage = options.storage || { head, put };
  const render = options.renderVideo || renderInstagramVideo;
  const inFlight = new Map();

  async function inventory() {
    if (env.VERCEL_ENV !== 'production') throw fail('production_required');
    return readStockInventories({ fetchImpl, now, withVideoDetails: true });
  }

  async function list() {
    const { items, sources } = await inventory();
    const inventoryNames = new Map();
    for (const source of sources) {
      for (const id of source.ids) inventoryNames.set(id, [...(inventoryNames.get(id) || []), source.name]);
    }
    return { ok: true, items: items.map(({ id, title, brand, model, plate, price, image }) => ({
      id, title, brand, model, plate, price, image: `${image};s=320x0`, sources: inventoryNames.get(id),
    })) };
  }

  async function select(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw fail('story_vehicle_invalid');
    if (!instagramVideoAccessConfigured(env)) throw fail('video_signing_not_configured');
    const { items } = await inventory();
    const current = items.find(item => item.id === id);
    if (!current) throw fail('story_vehicle_unavailable');
    const photos = current.photos.map(url => `${url};s=1440x0`);
    // The template receives the same verified stock fields as the automatic
    // renderer. Bind the actual ordered original photos, including secondary ones.
    return { ...galleryAsset(stockFeedRow(current), photos), vehicle: { id, title: current.title, price: current.price } };
  }

  async function ensureVideo({ item, fingerprint, path }) {
    if (await storedVideoSize(storage, path)) return { reused: true };
    const video = await render(item, { fetchImpl, deadline: Date.now() + 180000 });
    if ((await select(item.id)).fingerprint !== fingerprint) throw fail('stock_changed_during_render');
    return saveVideo(storage, path, video);
  }

  function links(id, fingerprint) {
    const videoUrl = signInstagramVideoUrl(id, fingerprint, env, now());
    const download = new URL(videoUrl);
    download.searchParams.set('download', '1');
    return { id, fingerprint, videoUrl, downloadUrl: download.href };
  }

  async function preview(id) {
    const selected = await select(id);
    const { path, fingerprint, vehicle } = selected;
    if (!inFlight.has(path)) {
      inFlight.set(path, ensureVideo(selected).finally(() => inFlight.delete(path)));
    }
    const { reused } = await inFlight.get(path);
    return { ok: true, status: 'preview_ready', ...links(id, fingerprint), vehicle, reused };
  }

  async function validate(id, fingerprint) {
    if (typeof fingerprint !== 'string' || !hashPattern.test(fingerprint)) throw fail('story_preview_required');
    const selected = await select(id);
    if (selected.fingerprint !== fingerprint) throw fail('stock_changed_before_publication');
    if (!await storedVideoSize(storage, selected.path)) throw fail('story_preview_required');
    return links(id, fingerprint);
  }

  return { list, preview, validate };
}
