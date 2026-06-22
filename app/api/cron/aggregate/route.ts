import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { writeJSON } from '@/etl/_lib.js';
import { aggregate } from '@/etl/aggregate.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Rolls every per-source file into dashboard.json.
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const dashboard = await aggregate();
    await writeJSON('dashboard.json', dashboard);
    return NextResponse.json({
      ok: true,
      source: 'aggregate',
      totalLeads30d: dashboard.summary.totalLeads30d,
      ranAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[cron:aggregate] failed:', err);
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
