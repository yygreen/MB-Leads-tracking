import { NextResponse } from 'next/server';
import { readJSON, writeJSON } from '@/etl/_lib.js';
import { aggregate } from '@/etl/aggregate.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// ONE-SHOT PROMOTION. Atomically copies the reviewed gbp_staging.json → gbp.json
// (the live key the dashboard reads), then re-runs aggregate() so dashboard.json
// reflects it immediately. This is the approved go-live for GBP.
//
// Safety: refuses if gbp.json is ALREADY populated — once live, the daily cron
// owns gbp.json, and re-promoting would revert it to the (now-stale) staging
// snapshot. So this can only perform the FIRST promotion; after that it no-ops.
// Guarded by ?confirm=promote-staging so nothing runs by accident.
const STAGING_KEY = 'gbp_staging.json';
const LIVE_KEY = 'gbp.json';

export async function POST(req: Request) {
  const url = new URL(req.url);
  const confirm = url.searchParams.get('confirm');
  const reaggregateOnly = url.searchParams.get('reaggregate') === '1';
  if (confirm !== 'promote-staging') {
    return NextResponse.json(
      { ok: false, error: 'refusing to run without ?confirm=promote-staging' },
      { status: 400 }
    );
  }

  // Rebuild dashboard.json from the current source blobs WITHOUT pulling or
  // touching gbp.json. Safe recompute — used to settle a read-after-write race
  // or to re-render after an env/flag change.
  if (reaggregateOnly) {
    try {
      const dashboard = await aggregate();
      await writeJSON('dashboard.json', dashboard);
      return NextResponse.json({
        ok: true,
        reaggregated: true,
        totalLeads30d: dashboard.summary.totalLeads30d,
        callrailQualified: dashboard.callrailQualified,
        gbpCalls30d: dashboard.summary.gbpCalls30d,
        gbpStates: dashboard.gbpStates,
        gbpLocations: dashboard.gbpLocations,
        ranAt: new Date().toISOString(),
      });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
  }

  try {
    const staging = (await readJSON(STAGING_KEY, [])) as any[];
    if (!Array.isArray(staging) || staging.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'gbp_staging.json is empty — nothing to promote' },
        { status: 400 }
      );
    }

    const existingLive = (await readJSON(LIVE_KEY, [])) as any[];
    if (Array.isArray(existingLive) && existingLive.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          alreadyPromoted: true,
          error: `gbp.json already has ${existingLive.length} records — refusing to overwrite live data (the daily cron now owns it).`,
        },
        { status: 409 }
      );
    }

    // Atomic copy staging -> live, then rebuild the dashboard from it.
    await writeJSON(LIVE_KEY, staging);
    const dashboard = await aggregate();
    await writeJSON('dashboard.json', dashboard);

    const gbpRows = staging.filter((r) => r && r.source === 'gbp');
    const byCity: Record<string, number> = {};
    for (const r of gbpRows) byCity[`${r.city}, ${r.state}`] = (byCity[`${r.city}, ${r.state}`] || 0) + 1;

    return NextResponse.json({
      ok: true,
      promoted: { from: STAGING_KEY, to: LIVE_KEY, records: staging.length },
      perLocationRecordCounts: byCity,
      totalLeads30d: dashboard.summary.totalLeads30d,
      gbpCalls30d: dashboard.summary.gbpCalls30d,
      gbpStates: dashboard.gbpStates,
      gbpLocations: dashboard.gbpLocations,
      ranAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
