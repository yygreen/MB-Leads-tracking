import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { writeJSON } from '@/etl/_lib.js';
import { pull as pullCallrail } from '@/etl/callrail.js';
import { pull as pullCalendly } from '@/etl/calendly.js';
import { pull as pullGbp } from '@/etl/gbp.js';
import { pull as pullGa4 } from '@/etl/ga4.js';
import { pull as pullLeadtrap } from '@/etl/leadtrap.js';
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

  const jobs: Array<[string, string, () => Promise<unknown[]>]> = [
    ['callrail', 'callrail.json', pullCallrail],
    ['calendly', 'calendly.json', pullCalendly],
    ['gbp', 'gbp.json', pullGbp],
    ['ga4', 'ga4.json', pullGa4],
    ['leadtrap', 'leadtrap.json', pullLeadtrap],
  ];

  const results: Record<string, { ok: boolean; count?: number; error?: string }> = {};
  for (const [name, file, pull] of jobs) {
    try {
      const records = await pull();
      await writeJSON(file, records);
      results[name] = { ok: true, count: records.length };
    } catch (err: any) {
      console.error(`[refresh-all:${name}]`, err);
      results[name] = { ok: false, error: String(err?.message || err) };
    }
  }

  let totalLeads30d = 0;
  try {
    const dashboard = await aggregate();
    await writeJSON('dashboard.json', dashboard);
    totalLeads30d = dashboard.summary.totalLeads30d;
  } catch (err: any) {
    console.error('[refresh-all:aggregate]', err);
    results.aggregate = { ok: false, error: String(err?.message || err) };
  }

  return NextResponse.json({ ok: true, results, totalLeads30d, ranAt: new Date().toISOString() });
}

export async function GET(req: Request) {
  return POST(req);
}
