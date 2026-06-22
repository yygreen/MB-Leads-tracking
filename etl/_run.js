// Tiny helpers shared by the standalone ETL entry points.
import { pathToFileURL } from 'node:url';

/** True when this module file is the one node was invoked with directly. */
export function isMain(moduleUrl) {
  if (!process.argv[1]) return false;
  return moduleUrl === pathToFileURL(process.argv[1]).href;
}

/** ISO (YYYY-MM-DD) date N days before today, UTC. */
export function daysAgoISO(n) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
