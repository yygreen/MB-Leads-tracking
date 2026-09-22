'use server';

import { runRefreshAll } from '@/lib/refreshAll';

// The dashboard's Refresh button. It used to POST to /api/refresh-all from the
// browser, which meant that route had to stay reachable without a secret — so
// setting CRON_SECRET would have broken the button.
//
// As a server action the work runs on the server with the credentials already
// in scope, so nothing is sent from the browser but the invocation itself, and
// /api/refresh-all can be locked down independently.
export async function refreshAllAction() {
  const result = await runRefreshAll();
  // Only the bits the UI needs; the per-source errors are already logged.
  return { ok: result.ok, totalLeads30d: result.totalLeads30d, ranAt: result.ranAt };
}
