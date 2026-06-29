import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Leadtrap has no REST API — leads arrive via /api/leadtrap-webhook and are
// stored one immutable blob per lead under the `leadtrap/` prefix. There is
// nothing to pull on a schedule, so the default GET just reports the current
// count.
//
//   ?reset=1 — purge every stored lead (one-time cleanup).
//   ?dump=1  — inspect the stored leads (ids / dates / utm).
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  if (params.get('reset') === '1') {
    const removed = await clearCollection('leadtrap');
    return NextResponse.json({ ok: true, reset: true, removed });
  }
  if (params.get('dump') === '1') {
    const rows = (await readCollection('leadtrap')) as any[];
    return NextResponse.json({
      ok: true,
      count: rows.length,
      ids: rows.map((r) => r.id),
      dates: rows.map((r) => r.timestamp),
      utm: rows.map((r) => `${r.utm_source}/${r.utm_medium}`),
    });
  }
  const rows = (await readCollection('leadtrap')) as any[];
  return NextResponse.json({ ok: true, source: 'leadtrap', count: rows.length });
}
