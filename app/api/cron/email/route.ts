import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Email is webhook-fed (info@ inbox → /api/email-webhook), one immutable blob
// per lead under the `email/` prefix. Nothing to pull on a schedule, so GET
// just reports the current count (no PII).
//
//   ?reset=1 — purge every stored email lead (one-time cleanup).
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (new URL(req.url).searchParams.get('reset') === '1') {
    // Reset is destructive, so require a secret even though the cron gate is
    // open. Accept EITHER the EMAIL_WEBHOOK_SECRET (x-webhook-secret header) —
    // so it can be purged with the same secret the Zap uses — OR a CRON_SECRET
    // bearer if one is configured.
    const ws = process.env.EMAIL_WEBHOOK_SECRET;
    const cs = process.env.CRON_SECRET;
    const okWebhook = ws && req.headers.get('x-webhook-secret') === ws;
    const okCron = cs && req.headers.get('authorization') === `Bearer ${cs}`;
    if (!okWebhook && !okCron) {
      return NextResponse.json(
        { ok: false, error: 'reset requires the x-webhook-secret header' },
        { status: 403 }
      );
    }
    const removed = await clearCollection('email');
    return NextResponse.json({ ok: true, reset: true, removed });
  }
  const rows = (await readCollection('email')) as any[];
  return NextResponse.json({ ok: true, source: 'email', count: rows.length });
}
