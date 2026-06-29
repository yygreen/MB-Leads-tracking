import { NextResponse } from 'next/server';
import { runCron, authorizeCron } from '@/lib/cron';
import { guardedWrite } from '@/etl/guard.js';
import { writeJSON, readJSON } from '@/etl/_lib.js';
import { pull } from '@/etl/leadtrap.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Leadtrap has no REST API — data arrives via /api/leadtrap-webhook. This
// handler is a placeholder; guardedWrite ensures an empty pull never wipes the
// webhook-collected leadtrap.json.
//
// ?reset=1 — one-time purge of leadtrap.json (used to drop a legacy raw record
// that included PHI before the sanitizing receiver shipped).
export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  if (params.get('reset') === '1') {
    await writeJSON('leadtrap.json', []);
    return NextResponse.json({ ok: true, reset: true });
  }
  if (params.get('dump') === '1') {
    const rows = (await readJSON('leadtrap.json', [])) as any[];
    let meta: any = null;
    try {
      const { head } = await import('@vercel/blob');
      const h = await head('leadtrap.json');
      meta = { size: h.size, uploadedAt: h.uploadedAt, url: h.url };
    } catch (err: any) {
      meta = { headError: String(err?.message || err) };
    }
    return NextResponse.json({
      ok: true,
      readCount: rows.length,
      ids: rows.map((r) => r.id),
      blobMeta: meta,
    });
  }
  return runCron(req, { source: 'leadtrap', file: 'leadtrap.json', pull, write: guardedWrite });
}
