import { NextResponse } from 'next/server';
import { appendRecord } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Receiver for email leads sent to info@mastermindbehavior.com. A Zapier/Make
// automation watches that inbox and POSTs each genuine inbound email here.
//
// PRIVACY: families email sensitive details (diagnosis, insurance). This is a
// marketing-attribution dashboard, so we store ONLY who emailed and when —
// sender name/email, subject, timestamp. The email BODY is never stored.
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
  const name = field(b, 'name', 'fromName', 'from_name', 'senderName') || null;
  const subject = field(b, 'subject', 'Subject') || null;

  // Must have a sender address, and drop internal/self mail (staff replies).
  if (!email) {
    return NextResponse.json({ ok: false, error: 'no sender email' }, { status: 400 });
  }
  if (/@(.*\.)?mastermindbehavior\.com$/i.test(email)) {
    return NextResponse.json({ ok: true, skipped: 'internal sender' });
  }

  // Dedup on the email's Message-ID when available, else sender + time.
  const id =
    field(b, 'messageId', 'message_id', 'id', 'internetMessageId') ||
    `${timestamp}|${email}`;

  const record = {
    source: 'email',
    id: String(id),
    timestamp,
    name,
    email,
    subject, // header only — body is intentionally never stored
  };

  try {
    await appendRecord('email', record.id, record);
  } catch (err) {
    console.error('[api/email-webhook] write failed:', err);
    return NextResponse.json({ ok: false, error: 'storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: record.id });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'email-webhook', method: 'POST' });
}
