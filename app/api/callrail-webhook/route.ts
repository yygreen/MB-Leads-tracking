import { NextResponse } from 'next/server';
import { readJSON, writeJSON } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Fallback receiver for CallRail's post-call webhook. Used when the polling
// ETL isn't sufficient (e.g. near-real-time needs). Normalizes into the same
// shape as etl/callrail.js and appends to callrail.json.
export async function POST(req: Request) {
  let c: any;
  try {
    c = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const record = {
    source: 'callrail',
    id: String(c.id || c.resource_id || `call_${Date.now()}`),
    timestamp: c.start_time || c.created_at || new Date().toISOString(),
    direction: c.direction || 'inbound',
    duration: c.duration ?? null,
    customer_name: c.customer_name || null,
    customer_phone: c.customer_phone_number || null,
    tracking_source: c.source_name || null,
    utm_source: c.utm_source || null,
    utm_medium: c.utm_medium || null,
    utm_campaign: c.utm_campaign || null,
  };

  try {
    const existing = (await readJSON('callrail.json', [])) as any[];
    existing.push(record);
    await writeJSON('callrail.json', existing);
  } catch (err) {
    console.error('[api/callrail-webhook] write failed:', err);
    return NextResponse.json({ ok: false, error: 'storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: record.id });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'callrail-webhook', method: 'POST' });
}
