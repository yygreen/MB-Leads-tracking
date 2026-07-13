import { NextResponse } from 'next/server';
import { appendRecord } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Receiver for email leads sent to info@mastermindbehavior.com. A Zapier/Make
// automation watches that inbox and POSTs each genuine inbound email here.
//
// PRIVACY: this is a marketing-attribution dashboard that only ever displays
// COUNTS — never who emailed. For a healthcare provider, the identity of a
// sender (and any subject line) is effectively PHI, so we deliberately store
// NOTHING identifying: only a timestamp and a one-way-hashed dedup key derived
// from the Message-ID. Sender name/email/subject and the body are used at
// request time (for the internal-sender filter and dedup) but never persisted.
//
// SECURITY: set EMAIL_WEBHOOK_SECRET in the environment and have the Zap send
// it as the `x-webhook-secret` header; requests without it are rejected. If the
// secret is unset the endpoint stays open (so it works before the secret is
// configured), but setting it is strongly recommended.

function field(obj: Record<string, any>, ...candidates: string[]) {
  const lower: Record<string, any> = {};
  for (const k of Object.keys(obj || {})) lower[k.toLowerCase()] = obj[k];
  for (const c of candidates) {
    const v = lower[c.toLowerCase()];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

// Pull a bare address out of a "Name <a@b.com>" style From header.
function parseEmail(raw: string | null): string | null {
  if (!raw) return null;
  const m = String(raw).match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

export async function POST(req: Request) {
  const secret = process.env.EMAIL_WEBHOOK_SECRET;
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }
  const b = body.data || body.email || body.payload || body;

  const timestamp =
    field(b, 'receivedAt', 'received_at', 'date', 'timestamp', 'internalDate') ||
    new Date().toISOString();
  const fromRaw = field(b, 'from', 'From', 'sender', 'fromEmail', 'from_email');
  const email = parseEmail(field(b, 'email', 'fromEmail', 'from_email') || fromRaw);

  // Must have a sender address, and drop internal/self mail (staff replies).
  // (email is used here only, at request time — it is never stored.)
  if (!email) {
    return NextResponse.json({ ok: false, error: 'no sender email' }, { status: 400 });
  }
  if (/@(.*\.)?mastermindbehavior\.com$/i.test(email)) {
    return NextResponse.json({ ok: true, skipped: 'internal sender' });
  }

  // Dedup key: Message-ID when available, else sender + time. This is only
  // passed to appendRecord, which one-way-hashes it into the blob's filename —
  // it is not stored in the record body, so no address is persisted.
  const dedupKey =
    field(b, 'messageId', 'message_id', 'id', 'internetMessageId') ||
    `${timestamp}|${email}`;

  // Stored record: timestamp only. Nothing identifying.
  const record = { source: 'email', timestamp };

  try {
    await appendRecord('email', String(dedupKey), record);
  } catch (err) {
    console.error('[api/email-webhook] write failed:', err);
    return NextResponse.json({ ok: false, error: 'storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'email-webhook', method: 'POST' });
}
