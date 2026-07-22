import { NextResponse } from 'next/server';
import {
  gbpCreds,
  getAccessToken,
  discover,
  partitionLocations,
  fetchLocationMetrics,
  metricsWindow,
  leadCount,
} from '@/etl/gbp.js';
import { readJSON, writeJSON } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// STAGING BACKFILL. Runs the live GBP pull (Feb 2026 → today−3, the four
// allowlisted profiles only) and writes the records to gbp_staging.json — NOT
// gbp.json. Because preview and production share one Blob store, gbp.json is the
// live dashboard's source and is left untouched; gbp_staging.json is inert (no
// reader) until an explicit, separate promotion step. After writing, it re-reads
// the staging artifact and rolls it up per-state-monthly so the summary reflects
// the actual file that would be promoted, not a re-computation from the API.
//
// Guarded: requires ?confirm=backfill-staging so nothing runs by accident.
const STAGING_KEY = 'gbp_staging.json';
const BACKFILL_TO = '2026-02-01';

export async function GET(req: Request) {
  const confirm = new URL(req.url).searchParams.get('confirm');
  if (confirm !== 'backfill-staging') {
    return NextResponse.json(
      {
        ok: false,
        error: 'refusing to run without ?confirm=backfill-staging',
        note: 'This endpoint writes gbp_staging.json (never gbp.json). Add the confirm token to run.',
      },
      { status: 400 }
    );
  }

  const creds = gbpCreds();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: 'GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN not set' },
      { status: 400 }
    );
  }

  try {
    const { accessToken, scope } = await getAccessToken(creds);
    if (!String(scope || '').includes('business.manage')) {
      return NextResponse.json(
        { ok: false, error: `token lacks business.manage (scope: ${scope})` },
        { status: 403 }
      );
    }

    const { locations } = await discover(accessToken);
    const { allowed, stray } = partitionLocations(locations);

    const { startDate, endDate } = metricsWindow({ backfillTo: BACKFILL_TO });
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // Pull each allowlisted location over the full backfill window.
    const records: any[] = [];
    const perLocationCounts: Record<string, number> = {};
    for (const loc of allowed) {
      const rows = await fetchLocationMetrics(loc as any, accessToken, {
        startDate,
        endDate,
        includeVisibility: true,
      });
      records.push(...rows);
      perLocationCounts[`${loc.city}, ${loc.state}`] = rows.length;
    }

    // WRITE to the staging key only. gbp.json is never touched here.
    await writeJSON(STAGING_KEY, records);

    // Re-read the written artifact and summarize FROM IT (not from `records`).
    const written = (await readJSON(STAGING_KEY, [])) as any[];

    const monthOf = (d: string) => d.slice(0, 7);
    const blank = () => ({
      leads: 0,
      calls: 0,
      websiteClicks: 0,
      directions: 0,
      impressions: 0,
    });
    const stateMap: Record<string, any> = {};
    const grand = blank();
    for (const r of written) {
      const m = monthOf(r.date);
      const st = r.state || 'Unknown';
      const key = `${st}|${m}`;
      stateMap[key] ??= { month: m, state: st, ...blank() };
      const lead = leadCount(r);
      stateMap[key].leads += lead;
      stateMap[key].calls += r.calls || 0;
      stateMap[key].websiteClicks += r.websiteClicks || 0;
      stateMap[key].directions += r.directions || 0;
      stateMap[key].impressions += r.impressions || 0;
      grand.leads += lead;
      grand.calls += r.calls || 0;
      grand.websiteClicks += r.websiteClicks || 0;
      grand.directions += r.directions || 0;
      grand.impressions += r.impressions || 0;
    }
    const perStateMonthly = Object.values(stateMap).sort(
      (a: any, b: any) => a.month.localeCompare(b.month) || String(a.state).localeCompare(b.state)
    );

    return NextResponse.json({
      ok: true,
      wrote: { key: STAGING_KEY, records: written.length, note: 'gbp.json NOT touched' },
      auth: { scope },
      window: { start: iso(startDate), end: iso(endDate), backfillTo: BACKFILL_TO, lagDays: 3 },
      allowlist: {
        allowedLocations: allowed.map((l) => ({ city: l.city, state: l.state, location_id: l.location_id })),
        strayLocationsSurfacedNotSummed: stray.map((l) => ({
          location_id: l.location_id,
          title: l.title,
          address: l.address,
        })),
      },
      perLocationRecordCounts: perLocationCounts,
      leadDefinition: 'leads = CALL_CLICKS + WEBSITE_CLICKS (directions/impressions = visibility, not leads)',
      grandTotals: grand,
      perStateMonthly,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
