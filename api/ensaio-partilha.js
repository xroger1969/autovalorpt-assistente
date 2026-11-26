import { readFile } from 'node:fs/promises';

const branch = 'codex/ensaio-partilha-telemovel';
const html = new URL('../ensaios/partilha.html', import.meta.url);
const guide = new URL('../ensaios/partilha.js', import.meta.url);
const jpg = new URL('../ensaios/partilha.jpg', import.meta.url);
const resources = new Map([
  ['pagina', [html, 'text/html; charset=utf-8']],
  ['editorial-preview.js', [new URL('../editorial-preview.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['whatsapp-editorial.js', [new URL('../whatsapp-editorial.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['rotina.css', [new URL('../rotina.css', import.meta.url), 'text/css; charset=utf-8']],
  ['ensaio.css', [new URL('../ensaios/partilha.css', import.meta.url), 'text/css; charset=utf-8']],
  ['guia.js', [guide, 'text/javascript; charset=utf-8']],
  ['amostra.jpg', [jpg, 'image/jpeg']]
]);

export function createShareRehearsalHandler(env = process.env) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== branch) {
      return res.status(404).end();
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).end();
    }
    const resource = req.query?.recurso ?? 'pagina';
    const entry = resources.get(resource);
    if (!entry) return res.status(404).end();
    const [file, type] = entry;
    const bytes = await readFile(file);
    res.setHeader('Content-Type', type);
    res.setHeader('X-Autovalor-Environment', 'share-rehearsal');
    if (req.method === 'HEAD') return res.status(200).end();
    if (resource === 'guia.js') {
      const sample = (await readFile(jpg)).toString('base64');
      return res.status(200).end(`const rehearsalJpeg = ${JSON.stringify(sample)};\n${bytes.toString('utf8')}`);
    }
    return res.status(200).end(bytes);
  };
}

export default createShareRehearsalHandler();
