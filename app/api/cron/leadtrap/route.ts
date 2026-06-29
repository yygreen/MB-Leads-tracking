import { runCron } from '@/lib/cron';
import { guardedWrite } from '@/etl/guard.js';
import { pull } from '@/etl/leadtrap.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Leadtrap has no REST API — data arrives via the /api/leadtrap-webhook
// receiver. This handler exists only as a placeholder; guardedWrite ensures an
// empty pull can never wipe the webhook-collected leadtrap.json.
export async function GET(req: Request) {
  return runCron(req, { source: 'leadtrap', file: 'leadtrap.json', pull, write: guardedWrite });
}
