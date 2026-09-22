import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { readCollection, clearCollection } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Leadtrap has no REST API — leads arrive via /api/leadtrap-webhook and are
// stored one immutable blob per lead under the `leadtrap/` prefix. There is
// nothing to pull on a schedule, so GET just reports the current lead count
// (no PII).
//
//   ?breakdown=1 — READ-ONLY diagnostic: how the stored leads distribute by
//                  Leadtrap's own A–D score, by type, by source and by month,
//                  plus dedup-key health. Counts only — never name/email/phone
//                  or any other identifying field.
//   ?reset=1     — purge every stored lead. Destructive, so it requires
//                  CRON_SECRET to be configured AND supplied as a Bearer token;
//                  without a secret it is disabled entirely.

// Timestamps arrive in whatever format Leadtrap's "First Seen At" uses (ISO or
// a human/RFC-style date), so parse properly rather than slicing the string.
function monthOf(raw: unknown): string {
  const s = String(raw || '');
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 7);
  const m = s.match(/\d{4}-\d{2}/);
  return m ? m[0] : 'unparsed';
}

// Leadtrap grades leads A–D; normalize "A", "a - excellent", etc. to the letter.
function scoreLetter(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'unscored';
  const m = s.match(/^([A-Da-d])\b/);
  return m ? m[1].toUpperCase() : 'other';
}

const tally = (rows: any[], pick: (r: any) => string) => {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = pick(r);
    out[k] = (out[k] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
};

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;

  if (params.get('reset') === '1') {
    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { ok: false, error: 'reset requires CRON_SECRET to be set' },
        { status: 403 }
      );
    }
    const removed = await clearCollection('leadtrap');
    return NextResponse.json({ ok: true, reset: true, removed });
  }

  const rows = (await readCollection('leadtrap')) as any[];

  if (params.get('breakdown') === '1') {
    const byScore = tally(rows, (r) => scoreLetter(r?.score));
    const scored = rows.length - (byScore.unscored || 0);
    // Dedup health: the webhook falls back to `${timestamp}|${email||phone}`
    // when Leadtrap sends no native id, which is a weaker key.
    const fallbackId = rows.filter((r) => String(r?.id || '').includes('|')).length;
    const noContact = rows.filter((r) => !r?.email && !r?.phone).length;

    return NextResponse.json({
      ok: true,
      source: 'leadtrap',
      count: rows.length,
      note: 'Read-only. Counts only — no name, email, phone or other identifying field is returned.',
      byScore,
      scoredShare: rows.length ? Math.round((scored / rows.length) * 1000) / 10 : 0,
      byType: tally(rows, (r) => String(r?.type ?? 'unknown')),
      bySource: tally(rows, (r) => String(r?.lead_source ?? 'unknown')),
      byMonth: tally(rows, (r) => monthOf(r?.timestamp)),
      dedup: {
        nativeLeadId: rows.length - fallbackId,
        fallbackKey: fallbackId,
        missingBothEmailAndPhone: noContact,
      },
    });
  }

  return NextResponse.json({ ok: true, source: 'leadtrap', count: rows.length });
}
