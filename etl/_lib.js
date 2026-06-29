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

/** Small helper so ETL jobs can log a consistent, greppable warning. */
export function warnMissingEnv(source, vars) {
  console.warn(
    `[etl:${source}] missing env (${vars.join(', ')}) — returning [] (no data pulled)`
  );
}
