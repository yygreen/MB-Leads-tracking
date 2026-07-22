import { NextResponse } from 'next/server';
import {
  gbpCreds,
  getAccessToken,
  discover,
  fetchLocationMetrics,
  metricsWindow,
} from '@/etl/gbp.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// DRY-RUN ONLY. Resolves the GBP group account + the four location IDs (with
// city mapping) and pulls a sample 7-day per-location metrics window — then
// returns it as JSON. It NEVER writes gbp.json or any data store; it exists so
// the discovery output can be reviewed before the live pull is approved.
export async function GET() {
  const creds = gbpCreds();
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: 'GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN not set' },
      { status: 400 }
    );
  }

  try {
    const { accessToken, scope } = await getAccessToken(creds);
    const hasBusinessManage = String(scope || '').includes('business.manage');

    const { account, accountCandidates, locations } = await discover(accessToken);

    // Sample: last 7 days ending at today − 3 (Performance API lag).
    const { endDate } = metricsWindow({ lagDays: 3 });
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const perLocation = [];
    for (const loc of locations) {
      const rows = await fetchLocationMetrics(loc as any, accessToken, {
        startDate,
        endDate,
        includeVisibility: true,
      });
      const sum = (k: string) => rows.reduce((a: number, r: any) => a + (r[k] || 0), 0);
      perLocation.push({
        city: loc.city,
        state: loc.state,
        location_id: loc.location_id,
        name: loc.name,
        title: loc.title,
        storeCode: loc.storeCode,
        address: loc.address,
        matchedToKnownProfile: loc.matched,
        sample_7d: {
          days_returned: rows.length,
          calls_CALL_CLICKS: sum('calls'),
          websiteClicks: sum('websiteClicks'),
          directions: sum('directions'),
          conversations: sum('conversations'),
          impressions_visibility_not_lead: sum('impressions'),
        },
        sample_daily: rows,
      });
    }

    // Per-state rollup of the 7-day sample (lead metrics only).
    const byState: Record<string, any> = {};
    for (const l of perLocation) {
      const st = l.state || 'Unknown';
      byState[st] ??= { state: st, locations: 0, calls: 0, websiteClicks: 0, directions: 0, conversations: 0 };
      byState[st].locations += 1;
      byState[st].calls += l.sample_7d.calls_CALL_CLICKS;
      byState[st].websiteClicks += l.sample_7d.websiteClicks;
      byState[st].directions += l.sample_7d.directions;
      byState[st].conversations += l.sample_7d.conversations;
    }

    return NextResponse.json({
      ok: true,
      dryRun: true,
      note: 'Read-only. No data was written to gbp.json or any store.',
      auth: { hasBusinessManage, scope },
      group: account,
      accountsVisibleToToken: accountCandidates,
      locationsResolved: locations.length,
      sampleWindow: { start: iso(startDate), end: iso(endDate), lagDays: 3 },
      perStateRollup: Object.values(byState),
      perLocation,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
