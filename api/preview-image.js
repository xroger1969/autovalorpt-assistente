import { readFileSync } from 'node:fs';

const previewImage = readFileSync(new URL('../preview-v5.png', import.meta.url));

export default function handler(req, res) {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(previewImage.length));
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, immutable');
  res.status(200).send(previewImage);
}
