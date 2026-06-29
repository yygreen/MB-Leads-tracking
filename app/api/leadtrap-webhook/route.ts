import { NextResponse } from 'next/server';
import { readJSON, writeJSON } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Receiver for Leadtrap's outbound webhook (no REST API on their side).
//
// PRIVACY: Leadtrap payloads carry sensitive PHI — chat transcript, child DOB/
// address, insurance ID numbers, and insurance-card image URLs. This is a
// marketing-attribution dashboard, so we deliberately store ONLY marketing
// fields + light qualifiers and DROP all PHI. The full lead lives in Leadtrap
// (and the client's CRM); we only need the lead's source and timing.

// Case-insensitive field lookup across candidate keys.
function field(obj: Record<string, any>, ...candidates: string[]) {
  const lower: Record<string, any> = {};
  for (const k of Object.keys(obj || {})) lower[k.toLowerCase()] = obj[k];
  for (const c of candidates) {
    const v = lower[c.toLowerCase()];
    if (v != null && String(v).trim() !== '') return v;
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
  const b = body.data || body.lead || body.payload || body;

  const timestamp =
    field(b, 'First Seen At', 'firstSeenAt', 'first_seen_at', 'timestamp', 'created_at') ||
    new Date().toISOString();
  const email = field(b, 'EMAIL', 'email', 'email_address');
  const phone = field(b, 'PHONE', 'phone', 'phone_number');
  const gclid = field(b, 'gclid');
  const sourceLabel = field(b, 'Source', 'UTM');

  // Derive UTM source/medium: Leadtrap leaves utm_* blank but provides Source /
  // gclid, so a Google Ads / gclid lead maps to google/cpc.
  let utm_source = field(b, 'utm_source');
  let utm_medium = field(b, 'utm_medium');
  if (!utm_source) {
    if (gclid || /google ?ads/i.test(String(sourceLabel || ''))) {
      utm_source = 'google';
      utm_medium = utm_medium || 'cpc';
    } else if (sourceLabel) {
      utm_source = String(sourceLabel).toLowerCase().trim();
    }
  }

  // Tehila confirmed no lead_id — dedup on "First Seen At" (+ a contact) instead.
  const id =
    field(b, 'id', 'lead_id', 'leadId') || `${timestamp}|${email || phone || ''}`;

  const record = {
    source: 'leadtrap',
    id: String(id),
    timestamp,
    type: field(b, 'Type'), // e.g. CHAT_BOT
    name: field(b, 'NAME', 'name', 'full_name'),
    email,
    phone,
    page_url: field(b, 'url', 'page_url', 'landing_page'),
    referrer: field(b, 'referrer'),
    utm_source: utm_source || null,
    utm_medium: utm_medium || null,
    utm_campaign: field(b, 'utm_campaign'),
    gclid: gclid || null,
    campaign_id: field(b, 'gad_campaignid', 'campaignid'),
    lead_source: sourceLabel || null, // "Google Ads"
    // light, low-sensitivity qualifiers
    city: field(b, 'City'),
    state: field(b, 'State'),
    insurance: field(b, 'Insurance'), // provider name only (not ID numbers)
    child_age: field(b, 'Child Age'),
    score: field(b, 'Score (A-D)', 'LEAD_SCORE'),
    // Intentionally NOT stored: TRANSCRIPT, Summary, insurance ID numbers,
    // child name/DOB/address, attachments, insurance-card images.
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
