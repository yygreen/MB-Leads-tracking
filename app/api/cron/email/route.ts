import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Email is webhook-fed (info@ inbox → /api/email-webhook), one immutable blob
// per lead under the `email/` prefix. Nothing to pull on a schedule, so GET
// just reports the current count (no PII).
//
//   ?reset=1 — purge every stored email lead (one-time cleanup).
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (new URL(req.url).searchParams.get('reset') === '1') {
    const removed = await clearCollection('email');
    return NextResponse.json({ ok: true, reset: true, removed });
  }
  const rows = (await readCollection('email')) as any[];
  return NextResponse.json({ ok: true, source: 'email', count: rows.length });
}
