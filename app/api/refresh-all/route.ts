import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { writeJSON } from '@/etl/_lib.js';
import { pull as pullCallrail } from '@/etl/callrail.js';
import { pull as pullGbp } from '@/etl/gbp.js';
import { pull as pullGa4 } from '@/etl/ga4.js';
import { pull as pullWebflow } from '@/etl/webflow.js';
import { guardedWrite } from '@/etl/guard.js';
import { aggregate } from '@/etl/aggregate.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Manual "refresh everything" — runs every ETL pull then re-aggregates. Backs
// the dashboard's refresh button. Each source is independent so one failing
// credential doesn't block the others.
export async function POST(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Note: leadtrap is webhook-only (no API), so it's not pulled here — its
  // leadtrap.json is populated by /api/leadtrap-webhook and must not be wiped.
  const jobs: Array<[string, string, () => Promise<unknown[]>]> = [
    ['callrail', 'callrail.json', pullCallrail],
    ['gbp', 'gbp.json', pullGbp],
    ['ga4', 'ga4.json', pullGa4],
  ];

  const results: Record<string, { ok: boolean; count?: number; error?: string }> = {};
  for (const [name, file, pull] of jobs) {
    try {
      const records = await pull();
      // guardedWrite: a transient empty pull never clobbers existing data.
      const written = await guardedWrite(file, records);
      results[name] = { ok: true, count: Array.isArray(written) ? written.length : records.length };
    } catch (err: any) {
      console.error(`[refresh-all:${name}]`, err);
      results[name] = { ok: false, error: String(err?.message || err) };
    }
  }

  // Webflow forms — authoritative forms.json (guarded so an empty pull never
  // wipes webhook-collected data).
  try {
    const records = await pullWebflow();
    const written = await guardedWrite('forms.json', records);
    results.webflow = {
      ok: true,
      count: Array.isArray(written) ? written.length : records.length,
    };
  } catch (err: any) {
    console.error('[refresh-all:webflow]', err);
    results.webflow = { ok: false, error: String(err?.message || err) };
  }

  let totalLeads30d = 0;
  let utmDebug: any = null;
  try {
    const dashboard = await aggregate();
    await writeJSON('dashboard.json', dashboard);
    totalLeads30d = dashboard.summary.totalLeads30d;
    const w = (dashboard as any).utmSourcesByWindow || {};
    utmDebug = {
      hasField: Boolean((dashboard as any).utmSourcesByWindow),
      totals: {
        '30': (w['30'] || []).reduce((a: number, r: any) => a + r.count, 0),
        '90': (w['90'] || []).reduce((a: number, r: any) => a + r.count, 0),
        '180': (w['180'] || []).reduce((a: number, r: any) => a + r.count, 0),
      },
    };
  } catch (err: any) {
    console.error('[refresh-all:aggregate]', err);
    results.aggregate = { ok: false, error: String(err?.message || err) };
  }

  return NextResponse.json({ ok: true, results, totalLeads30d, utmDebug, ranAt: new Date().toISOString() });
}

export async function GET(req: Request) {
  return POST(req);
}
