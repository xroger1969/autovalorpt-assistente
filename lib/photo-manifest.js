import { get, list, put } from '@vercel/blob';
import {
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  attachmentPath,
  isValidBatchId,
  isValidViewerToken,
  manifestPath,
  photoPrefix,
  sessionHasExpired,
  uploadTokenAuthorized,
  viewerTokenMatches
} from './photo-security.js';

function photoError(code, message, status = 422) {
  return Object.assign(new Error(message), { code, status });
}

function publicAttachment(attachment) {
  return {
    batchId: attachment.batchId,
    count: attachment.paths.length,
    paths: [...attachment.paths],
    createdAt: attachment.createdAt
  };
}

// Dependency injection keeps quota, ownership and retry tests independent of a
// live store. All production reads bypass caches for the submission boundary.
export function createPhotoRepository(storage = { get, list, put }) {
  async function loadJson(pathname) {
    const result = await storage.get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null;
    try {
      return JSON.parse(await new Response(result.stream).text());
    } catch {
      return null;
    }
  }

  async function loadPhotoManifest(batchId = '') {
    if (!isValidBatchId(batchId)) return null;
    return loadJson(manifestPath(batchId));
  }

  async function loadPhotoAttachment(batchId = '') {
    if (!isValidBatchId(batchId)) return null;
    const attachment = await loadJson(attachmentPath(batchId));
    if (!attachment || attachment.batchId !== batchId || !Array.isArray(attachment.paths)) return null;
    return attachment;
  }

  async function loadAuthorizedPhotoManifest(batchId = '', viewerToken = '') {
    if (!isValidBatchId(batchId) || !isValidViewerToken(viewerToken)) return null;
    const manifest = await loadPhotoManifest(batchId);
    if (!manifest || sessionHasExpired(manifest) || !viewerTokenMatches(viewerToken, manifest.viewerTokenHash)) return null;
    return manifest;
  }

  async function loadAuthorizedUploadManifest(batchId = '', uploadToken = '') {
    if (!isValidBatchId(batchId) || !isValidViewerToken(uploadToken)) return null;
    const manifest = await loadPhotoManifest(batchId);
    if (!manifest || !uploadTokenAuthorized(manifest, uploadToken)) return null;
    if (await loadPhotoAttachment(batchId)) return null;
    return manifest;
  }

  async function listPhotoBlobs(manifest, attachment = undefined) {
    const batchId = manifest?.batchId;
    if (!isValidBatchId(batchId)) return [];
    const prefix = photoPrefix(batchId);
    const saved = attachment === undefined ? await loadPhotoAttachment(batchId) : attachment;
    const result = await storage.list({ prefix, limit: Number(manifest.version) >= 2 ? MAX_PHOTOS + 1 : 100 });
    const allowed = saved ? new Set(saved.paths) : null;
    return (result?.blobs || [])
      .filter((blob) => {
        const pathname = String(blob?.pathname || '');
        if (!pathname.startsWith(prefix)) return false;
        const filename = pathname.slice(prefix.length);
        const valid = Number(manifest.version) >= 2
          ? /^(0[1-9]|10)$/.test(filename)
          : /^(0[1-9]|10)\.(jpg|jpeg|png|webp|heic|heif)$/i.test(filename);
        return valid && (!allowed || allowed.has(pathname));
      })
      .sort((a, b) => String(a.pathname).localeCompare(String(b.pathname)))
      .slice(0, MAX_PHOTOS);
  }

  async function attachPhotoSessionToLead(session, leadId) {
    if (!session) return null;
    const batchId = String(session.batchId || '');
    const uploadToken = String(session.uploadToken || '');
    if (!isValidBatchId(batchId) || !isValidViewerToken(uploadToken) || !/^[a-f0-9]{32}$/.test(String(leadId))) {
      throw photoError('invalid_photo_session', 'O envio de fotografias é inválido.');
    }
    const manifest = await loadPhotoManifest(batchId);
    if (!manifest || !viewerTokenMatches(uploadToken, manifest.uploadTokenHash)) {
      throw photoError('invalid_photo_session', 'Este envio de fotografias já não é válido.', 422);
    }
    const existing = await loadPhotoAttachment(batchId);
    if (existing) {
      if (existing.leadId !== leadId) throw photoError('photos_already_attached', 'Estas fotografias já pertencem a outro pedido.', 422);
      return publicAttachment(existing);
    }
    if (!uploadTokenAuthorized(manifest, uploadToken)) {
      throw photoError('photo_session_expired', 'O prazo de envio das fotografias terminou. Inicie um novo envio.', 422);
    }
    const photos = await listPhotoBlobs(manifest, null);
    if (!photos.length || photos.some((photo) => !Number.isFinite(Number(photo.size)) || Number(photo.size) < 1 || Number(photo.size) > MAX_PHOTO_BYTES)) {
      throw photoError('photos_not_ready', 'As fotografias ainda não estão prontas. Aguarde e tente novamente.', 422);
    }
    // Refuse to silently drop an upload that the browser has already completed.
    if (Number(session.count) > photos.length) {
      throw photoError('photos_not_ready', 'Ainda estamos a confirmar todas as fotografias. Tente novamente.', 422);
    }
    const attachment = {
      version: 1,
      batchId,
      leadId,
      createdAt: new Date().toISOString(),
      paths: photos.map((photo) => photo.pathname)
    };
    try {
      await storage.put(attachmentPath(batchId), JSON.stringify(attachment), {
        access: 'private', addRandomSuffix: false, allowOverwrite: false,
        contentType: 'application/json', cacheControlMaxAge: 60
      });
    } catch (error) {
      // Atomic create prevents two submissions claiming the same photo batch.
      const winner = await loadPhotoAttachment(batchId);
      if (winner?.leadId === leadId) return publicAttachment(winner);
      if (winner) throw photoError('photos_already_attached', 'Estas fotografias já pertencem a outro pedido.', 422);
      throw error;
    }
    return publicAttachment(attachment);
  }

  return {
    loadPhotoManifest, loadPhotoAttachment, loadAuthorizedPhotoManifest,
    loadAuthorizedUploadManifest, listPhotoBlobs, attachPhotoSessionToLead
  };
}

const repository = createPhotoRepository();
export const {
  loadPhotoManifest, loadPhotoAttachment, loadAuthorizedPhotoManifest,
  loadAuthorizedUploadManifest, listPhotoBlobs, attachPhotoSessionToLead
} = repository;
