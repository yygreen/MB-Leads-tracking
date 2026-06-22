import { runCron } from '@/lib/cron';
import { writeJSON } from '@/etl/_lib.js';
import { pull } from '@/etl/ga4.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
  return runCron(req, { source: 'ga4', file: 'ga4.json', pull, write: writeJSON });
}
