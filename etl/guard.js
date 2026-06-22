// Write guard: prevents a freshly-pulled, empty result from clobbering good
// data already on disk/blob (e.g. a transient API outage returning []). The
// ETL jobs can route their writes through this instead of writeJSON directly
// once real data is flowing.
import { readJSON, writeJSON } from './_lib.js';

export async function guardedWrite(file, incoming, { allowEmpty = false } = {}) {
  if (!Array.isArray(incoming)) {
    return writeJSON(file, incoming);
  }
  if (incoming.length === 0 && !allowEmpty) {
    const existing = await readJSON(file, []);
    if (Array.isArray(existing) && existing.length > 0) {
      console.warn(
        `[guard] refusing to overwrite ${file} (${existing.length} records) with empty pull`
      );
      return existing;
    }
  }
  return writeJSON(file, incoming);
}
