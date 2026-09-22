import { writeJSON } from '@/etl/_lib.js';
import { pull as pullCallrail } from '@/etl/callrail.js';
import { pull as pullGbp } from '@/etl/gbp.js';
import { pull as pullGa4 } from '@/etl/ga4.js';
import { pull as pullWebflow } from '@/etl/webflow.js';
import { guardedWrite } from '@/etl/guard.js';
import { aggregate } from '@/etl/aggregate.js';

export type RefreshResult = {
  ok: true;
  results: Record<string, { ok: boolean; count?: number; error?: string }>;
  totalLeads30d: number;
  ranAt: string;
};

// "Refresh everything" — runs every ETL pull then re-aggregates. Shared by the
// cron-gated /api/refresh-all route and the dashboard's Refresh button, which
// calls it through a server action. Keeping the work here rather than in the
// route means the button never needs to authenticate over HTTP: it already
// runs on the server, where the credentials live.
//
// Each source is independent so one failing credential doesn't block the rest.
export async function runRefreshAll(): Promise<RefreshResult> {
  // Note: leadtrap and email are webhook-only (no API), so they're not pulled
  // here — their records are append-only and must not be wiped.
  const jobs: Array<[string, string, () => Promise<unknown[]>]> = [
    ['callrail', 'callrail.json', pullCallrail],
    ['gbp', 'gbp.json', pullGbp],
    ['ga4', 'ga4.json', pullGa4],
  ];

  const results: RefreshResult['results'] = {};
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
  try {
    const dashboard = await aggregate();
    await writeJSON('dashboard.json', dashboard);
    totalLeads30d = dashboard.summary.totalLeads30d;
  } catch (err: any) {
    console.error('[refresh-all:aggregate]', err);
    results.aggregate = { ok: false, error: String(err?.message || err) };
  }

  return { ok: true, results, totalLeads30d, ranAt: new Date().toISOString() };
}
