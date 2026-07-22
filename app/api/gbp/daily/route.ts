import { NextResponse } from 'next/server';
import { readJSON } from '@/etl/_lib.js';
import { ALLOWED_LOCATION_IDS } from '@/etl/gbp.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Read-only daily GBP records for the date-range picker. Serves the backfilled
// per-location daily rows straight from gbp.json — it NEVER calls the
// Performance API, so picker changes are pure client-side re-slicing of this
// data. The floor is whatever is actually in the file (backfilled to Feb 2026),
// and the reported ceiling is today − 3 (the Performance API ~3-day lag).
export async function GET() {
  const allowed = new Set(ALLOWED_LOCATION_IDS);

  let raw: unknown = [];
  try {
    raw = await readJSON('gbp.json', []);
  } catch {
    raw = [];
  }
  const rows = Array.isArray(raw) ? raw : [];

  const records = rows
    .filter((r: any) => r && allowed.has(r.location_id) && r.date)
    .map((r: any) => ({
      date: r.date as string,
      city: r.city as string,
      state: (r.state ?? null) as string | null,
      location_id: r.location_id as string,
      calls: Number(r.calls) || 0,
      websiteClicks: Number(r.websiteClicks) || 0,
      directions: Number(r.directions) || 0,
      impressions: Number(r.impressions) || 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const minDate = records.length ? records[0].date : null;

  // Ceiling: today − 3 (UTC). Also surface "today" so the client can mark a
  // picked range that reaches into the unreported last 3 days as provisional.
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const today = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() - 3);
  const dataEnd = d.toISOString().slice(0, 10);

  return NextResponse.json(
    { ok: true, lagDays: 3, minDate, dataEnd, today, records },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
