// Leadtrap pull — PLACEHOLDER.
// The Leadtrap API shape is not yet known. When the client provides docs +
// credentials, wire the request here and normalize into records of the form:
//   { source: 'leadtrap', id, timestamp, utm_source, utm_medium, ... }
// Standalone: `node etl/leadtrap.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain } from './_run.js';

export async function pull() {
  const apiKey = process.env.LEADTRAP_API_KEY;
  if (!apiKey) {
    warnMissingEnv('leadtrap', ['LEADTRAP_API_KEY']);
    return [];
  }

  // TODO: replace with the real Leadtrap endpoint once documented.
  console.warn('[etl:leadtrap] API shape unknown — placeholder, returning []');
  return [];
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('leadtrap.json', records).then(() => records))
    .then((records) => console.log(`[etl:leadtrap] wrote ${records.length} records`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
