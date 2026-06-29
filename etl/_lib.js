// Storage abstraction shared by every ETL job and the /api routes.
//
//   - If BLOB_READ_WRITE_TOKEN is set  -> read/write Vercel Blob.
//   - Otherwise                        -> read/write ./data/*.json on disk,
//                                          which is what local dev and
//                                          `node etl/*.js` use.
//
// Keeping this behind two tiny functions means the rest of the codebase never
// has to care where the data physically lives.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// --- local disk -----------------------------------------------------------

async function readLocal(filename, fallback) {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeLocal(filename, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    path.join(DATA_DIR, filename),
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

// --- vercel blob ----------------------------------------------------------

// Vercel Blob stores are private by default, so we write and read with
// access: 'private' and pull the content back through the authenticated get().
async function readBlob(filename, fallback) {
  const { get } = await import('@vercel/blob');
  let result;
  try {
    result = await get(filename, { access: 'private' });
  } catch (err) {
    // BlobNotFoundError → no data yet; anything else we also fall back safely.
    return fallback;
  }
  if (!result || !result.stream) return fallback;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function writeBlob(filename, data) {
  const { put } = await import('@vercel/blob');
  await put(filename, JSON.stringify(data, null, 2), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    // We overwrite the same pathname on every ETL run, so the blob's download
    // URL is stable. Vercel Blob defaults to a 1-year cache, which means a
    // freshly-written file keeps serving its OLD content from the CDN edge —
    // making read-after-write return stale data (e.g. aggregate missing a lead
    // a webhook just appended). cacheControlMaxAge: 0 disables that edge cache
    // so reads always reflect the latest write.
    cacheControlMaxAge: 0,
  });
}

// --- public API -----------------------------------------------------------

export async function readJSON(filename, fallback = null) {
  return useBlob() ? readBlob(filename, fallback) : readLocal(filename, fallback);
}

export async function writeJSON(filename, data) {
  if (useBlob()) {
    await writeBlob(filename, data);
  } else {
    await writeLocal(filename, data);
  }
  return data;
}

// --- append-only collections (one immutable blob per record) --------------
//
// Vercel Blob is an object store optimised for IMMUTABLE assets: once a
// pathname has been fetched, its content is cached on the CDN edge and an
// overwrite at the same pathname keeps serving the stale copy. That makes the
// "read whole array → push → write whole array back" pattern unreliable for
// webhook data (a lead a webhook just appended can be invisible to the next
// aggregate, and concurrent writes clobber each other).
//
// For append-only sources (Leadtrap), we instead write ONE blob per record
// under `${collection}/${hash(id)}.json`. Each record blob is written once and
// never mutated, so its cache is always correct. `list()` enumerates the
// current set via the metadata API (consistent, not the cached download), so a
// freshly-appended record is immediately visible.

function recordName(collection, id) {
  const hash = crypto.createHash('sha1').update(String(id)).digest('hex');
  return `${collection}/${hash}.json`;
}

async function readBlobByName(name) {
  const { get } = await import('@vercel/blob');
  const result = await get(name, { access: 'private' });
  if (!result || !result.stream) return null;
  return JSON.parse(await new Response(result.stream).text());
}

/** Append one record to a collection, keyed by a stable id (idempotent). */
export async function appendRecord(collection, id, record) {
  if (useBlob()) {
    const { head, put } = await import('@vercel/blob');
    const name = recordName(collection, id);
    try {
      await head(name);
      return record; // already stored — don't overwrite (avoids cache churn)
    } catch {
      /* not found — fall through to write */
    }
    await put(name, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } else {
    const dir = path.join(DATA_DIR, collection);
    await fs.mkdir(dir, { recursive: true });
    const hash = crypto.createHash('sha1').update(String(id)).digest('hex');
    await fs.writeFile(path.join(dir, `${hash}.json`), JSON.stringify(record), 'utf8');
  }
  return record;
}

/** Read every record in a collection back as an array. */
export async function readCollection(collection) {
  if (useBlob()) {
    const { list } = await import('@vercel/blob');
    const out = [];
    let cursor;
    do {
      const res = await list({ prefix: `${collection}/`, cursor, limit: 1000 });
      for (const b of res.blobs) {
        try {
          const rec = await readBlobByName(b.pathname);
          if (rec) out.push(rec);
        } catch {
          /* skip unreadable record */
        }
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
    return out;
  }
  const dir = path.join(DATA_DIR, collection);
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
    } catch {
      /* skip */
    }
  }
  return out;
}

/** Delete every record in a collection (used by the one-time reset). */
export async function clearCollection(collection) {
  if (useBlob()) {
    const { list, del } = await import('@vercel/blob');
    let cursor;
    let removed = 0;
    do {
      const res = await list({ prefix: `${collection}/`, cursor, limit: 1000 });
      if (res.blobs.length) {
        await del(res.blobs.map((b) => b.url));
        removed += res.blobs.length;
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);
    return removed;
  }
  const dir = path.join(DATA_DIR, collection);
  try {
    const files = await fs.readdir(dir);
    await fs.rm(dir, { recursive: true, force: true });
    return files.length;
  } catch {
    return 0;
  }
}

/** Small helper so ETL jobs can log a consistent, greppable warning. */
export function warnMissingEnv(source, vars) {
  console.warn(
    `[etl:${source}] missing env (${vars.join(', ')}) — returning [] (no data pulled)`
  );
}
