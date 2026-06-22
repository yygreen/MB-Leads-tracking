import { NextResponse } from 'next/server';
import { readJSON } from '@/etl/_lib.js';
import { getMockDashboard } from '@/lib/mockData';
import type { DashboardData } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Serves the aggregated dashboard.json. Falls back to rich mock data whenever
// there is no real data yet (no blob written, or an empty roll-up) so preview
// deploys with zero env vars still render every section.
export async function GET() {
  let data: DashboardData | null = null;
  try {
    data = (await readJSON('dashboard.json', null)) as DashboardData | null;
  } catch (err) {
    console.error('[api/data] read failed, serving mock:', err);
  }

  if (!data || !data.summary || data.summary.totalLeads30d === 0) {
    data = getMockDashboard();
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
