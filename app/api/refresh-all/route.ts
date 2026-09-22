import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { runRefreshAll } from '@/lib/refreshAll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Manual "refresh everything" for scripted/scheduled use. The dashboard's
// Refresh button no longer comes through here — it calls the runRefreshAll
// server action directly (see app/actions.ts) — so this route can be locked
// down with CRON_SECRET without breaking the UI.
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await runRefreshAll());
}

// Deliberately no GET handler. This route runs every ETL pull, so a GET alias
// meant any crawler that found the URL could trigger the full set of upstream
// API calls.
