import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection, deleteFromCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Email is webhook-fed (info@ inbox → /api/email-webhook), one immutable blob
// per lead under the `email/` prefix. Nothing to pull on a schedule, so GET
// just reports the current count (no PII).
//
//   ?dates=1        — list the stored lead dates (counts only, no PII).
//   ?removeDate=YYYY-MM-DD[,YYYY-MM-DD] — delete only the leads recorded on
//                     those UTC dates (e.g. to drop a test send). Preferred over
//                     ?reset, which purges everything.
//   ?reset=1        — purge every stored email lead (one-time cleanup).
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;

  // Destructive operations require a secret even though the cron gate is open.
  // Accept EITHER the EMAIL_WEBHOOK_SECRET (x-webhook-secret header) — so it can
  // be managed with the same secret the Zap uses — OR a CRON_SECRET bearer.
  const authorizedForWrite = () => {
    const ws = process.env.EMAIL_WEBHOOK_SECRET;
    const cs = process.env.CRON_SECRET;
    const okWebhook = ws && req.headers.get('x-webhook-secret') === ws;
    const okCron = cs && req.headers.get('authorization') === `Bearer ${cs}`;
    return Boolean(okWebhook || okCron);
  };

  // Timestamps arrive in whatever format the mail source used — ISO
  // ("2026-07-27T11:15:00Z") or an RFC-2822 header date ("Mon, 27 Jul 2026
  // ..."). Parse to a real Date and take the UTC day, matching how the
  // aggregate buckets leads; fall back to a leading ISO date if unparseable.
  const dayOf = (r: any) => {
    const raw = String(r?.timestamp || '');
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
    const m = raw.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : '';
  };

  // Targeted removal — drops only the leads recorded on the given UTC date(s).
  const removeDate = params.get('removeDate');
  if (removeDate) {
    if (!authorizedForWrite()) {
      return NextResponse.json(
        { ok: false, error: 'removeDate requires the x-webhook-secret header' },
        { status: 403 }
      );
    }
    const targets = new Set(
      removeDate
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean)
    );
    const removed = await deleteFromCollection('email', (r: any) => targets.has(dayOf(r)));
    const rows = (await readCollection('email')) as any[];
    return NextResponse.json({
      ok: true,
      removedDates: [...targets],
      removed,
      remaining: rows.length,
    });
  }

  if (params.get('reset') === '1') {
    if (!authorizedForWrite()) {
      return NextResponse.json(
        { ok: false, error: 'reset requires the x-webhook-secret header' },
        { status: 403 }
      );
    }
    const removed = await clearCollection('email');
    return NextResponse.json({ ok: true, reset: true, removed });
  }

  const rows = (await readCollection('email')) as any[];
  // Dates are safe to expose (a count per day, nothing identifying) and let a
  // test send be pinpointed before removing it.
  if (params.get('dates') === '1') {
    const byDate: Record<string, number> = {};
    for (const r of rows) byDate[dayOf(r)] = (byDate[dayOf(r)] || 0) + 1;
    return NextResponse.json({ ok: true, source: 'email', count: rows.length, byDate });
  }
  return NextResponse.json({ ok: true, source: 'email', count: rows.length });
}
