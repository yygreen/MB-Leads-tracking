import { NextResponse } from 'next/server';
import { readJSON, writeJSON } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Receiver for Leadtrap's outbound webhook. Leadtrap has no REST API but POSTs
// each new captured lead here. The payload shape is customizable on their side,
// so we read fields flexibly and also keep the raw body so nothing is lost and
// the mapping can be refined later. Deduped by lead id; appended to leadtrap.json.
function pick(body: any, keys: string[]) {
  for (const k of keys) {
    if (body && body[k] != null && body[k] !== '') return body[k];
  }
  return null;
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  // Some webhooks wrap the lead under data/lead/payload.
  const b = body.data || body.lead || body.payload || body;

  const record = {
    source: 'leadtrap',
    id: String(pick(b, ['id', 'lead_id', 'leadId', 'uuid']) || `leadtrap_${Date.now()}`),
    timestamp:
      pick(b, ['timestamp', 'created_at', 'createdAt', 'created_on', 'date', 'capturedAt']) ||
      new Date().toISOString(),
    name: pick(b, ['name', 'full_name', 'fullName', 'contact_name']),
    email: pick(b, ['email', 'email_address']),
    phone: pick(b, ['phone', 'phone_number', 'phoneNumber', 'tel']),
    page_url: pick(b, ['page_url', 'pageUrl', 'url', 'landing_page', 'page']),
    utm_source: pick(b, ['utm_source']),
    utm_medium: pick(b, ['utm_medium']),
    utm_campaign: pick(b, ['utm_campaign']),
    utm_term: pick(b, ['utm_term']),
    utm_content: pick(b, ['utm_content']),
    gclid: pick(b, ['gclid']),
    transcript: pick(b, ['transcript', 'chat_transcript', 'conversation', 'messages']),
    raw: b,
  };

  try {
    const existing = (await readJSON('leadtrap.json', [])) as any[];
    if (!existing.some((r) => r.id === record.id)) {
      existing.push(record);
      await writeJSON('leadtrap.json', existing);
    }
  } catch (err) {
    console.error('[api/leadtrap-webhook] write failed:', err);
    return NextResponse.json({ ok: false, error: 'storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: record.id });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'leadtrap-webhook', method: 'POST' });
}
