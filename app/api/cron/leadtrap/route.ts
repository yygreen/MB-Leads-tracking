import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Leadtrap has no REST API — leads arrive via /api/leadtrap-webhook and are
// stored one immutable blob per lead under the `leadtrap/` prefix. There is
// nothing to pull on a schedule, so GET just reports the current lead count
// (no PII).
//
//   ?reset=1 — purge every stored lead. Destructive, so it requires
//              CRON_SECRET to be configured AND supplied as a Bearer token;
//              without a secret it is disabled entirely.
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  if (params.get('reset') === '1') {
    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { ok: false, error: 'reset requires CRON_SECRET to be set' },
        { status: 403 }
      );
    }
    const removed = await clearCollection('leadtrap');
    return NextResponse.json({ ok: true, reset: true, removed });
  }
  const rows = (await readCollection('leadtrap')) as any[];
  return NextResponse.json({ ok: true, source: 'leadtrap', count: rows.length });
}
