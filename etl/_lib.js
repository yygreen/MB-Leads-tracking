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

async function readBlob(filename, fallback) {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: filename });
  const match = blobs.find((b) => b.pathname === filename);
  if (!match) return fallback;
  const res = await fetch(match.url, { cache: 'no-store' });
  if (!res.ok) return fallback;
  return res.json();
}

async function writeBlob(filename, data) {
  const { put } = await import('@vercel/blob');
  await put(filename, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
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
