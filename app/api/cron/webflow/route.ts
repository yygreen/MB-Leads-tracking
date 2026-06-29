import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { guardedWrite } from '@/etl/guard.js';
import { pull, sampleRaw } from '@/etl/webflow.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Webflow is the authoritative forms source (full, deduped 180-day pull). It
// overwrites forms.json — but via guardedWrite, so an empty pull (missing token
// or transient API error) never clobbers the webhook-collected data.
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  // ?debug=1 returns the submission structure (no PII) to verify field names.
  if (new URL(req.url).searchParams.get('debug') === '1') {
    try {
      return NextResponse.json({ ok: true, debug: await sampleRaw() });
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
    }
  }
  try {
    const records = await pull();
    const written = await guardedWrite('forms.json', records);
    return NextResponse.json({
      ok: true,
      source: 'webflow',
      pulled: records.length,
      stored: Array.isArray(written) ? written.length : null,
      ranAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[cron:webflow] failed:', err);
    return NextResponse.json(
      { ok: false, source: 'webflow', error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
