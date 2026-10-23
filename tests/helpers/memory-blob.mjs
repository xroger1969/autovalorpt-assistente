export function memoryBlob() {
  const records = new Map();
  const calls = [];
  const faults = {};
  let revision = 0;
  const conflict = () => Object.assign(new Error('Precondition failed'), { name: 'BlobPreconditionFailedError', status: 412 });
  const storage = {
    async get(path, options) {
      calls.push({ method: 'get', path, options });
      if (faults.get?.(path, options)) throw new Error('Mock storage read failure');
      const record = records.get(path);
      return record ? { statusCode: 200, stream: new Response(record.text).body, blob: { etag: record.etag } } : null;
    },
    async put(path, text, options) {
      calls.push({ method: 'put', path, options });
      if (faults.put?.(path, JSON.parse(text), options)) throw new Error('Mock storage write failure');
      const existing = records.get(path);
      if (options.ifMatch && existing?.etag !== options.ifMatch) throw conflict();
      if (existing && !options.allowOverwrite) throw conflict();
      if (options.allowOverwrite && !options.ifMatch) throw new Error('Unsafe unconditional overwrite');
      const etag = `etag-${++revision}`;
      records.set(path, { text, etag });
      return { pathname: path, etag };
    },
    async list({ prefix, limit = 1000, cursor }) {
      calls.push({ method: 'list', prefix });
      const matches = [...records.keys()].filter((path) => path.startsWith(prefix)).sort();
      const offset = Number(cursor || 0);
      const page = matches.slice(offset, offset + limit);
      return { blobs: page.map((pathname) => ({ pathname })), hasMore: offset + limit < matches.length, cursor: String(offset + limit) };
    },
    async del(path, options = {}) {
      calls.push({ method: 'del', path, options });
      if (options.ifMatch && records.get(path)?.etag !== options.ifMatch) throw conflict();
      records.delete(path);
    }
  };
  return { storage, records, calls, faults };
}
