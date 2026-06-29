import { NextResponse } from 'next/server';
import { readJSON, writeJSON } from '@/etl/_lib.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Real-time webhook receiver for Webflow form submissions. The UTM tracking JS
// already installed on mastermindbehavior.com posts a payload carrying all the
// attribution fields; we normalize and append to forms.json. The next
// aggregate cron rolls it into the dashboard.
export async function POST(req: Request) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  // Webflow nests the submitted fields under `data` (or `formResponse`); also
  // accept a flat body for direct posts from the tracking script.
  const fields = payload.data || payload.formResponse || payload.fields || payload;

  const record = {
    source: 'forms',
    id: payload.id || payload._id || `form_${Date.now()}`,
    formName: fields.formName || payload.formName || fields.form || payload.name || 'Contact Form',
    timestamp: payload.submittedAt || payload.createdOn || new Date().toISOString(),
    name: fields.name || fields.fullName || null,
    email: fields.email || null,
    phone: fields.phone || null,
    insurance: fields.insurance || null,
    zip: fields.zip || fields.zip_code || fields.zipCode || null,
    utm_source: fields.utm_source || null,
    utm_medium: fields.utm_medium || null,
    utm_campaign: fields.utm_campaign || null,
    utm_term: fields.utm_term || null,
    utm_content: fields.utm_content || null,
    gclid: fields.gclid || null,
    fbclid: fields.fbclid || null,
    msclkid: fields.msclkid || null,
    landing_page: fields.landing_page || null,
    referrer: fields.referrer || null,
    first_touch_source: fields.first_touch_source || null,
    first_touch_landing: fields.first_touch_landing || null,
    first_touch_date: fields.first_touch_date || null,
    page_url: fields.page_url || null,
    user_agent_summary: fields.user_agent_summary || null,
  };

  try {
    const existing = (await readJSON('forms.json', [])) as any[];
    existing.push(record);
    await writeJSON('forms.json', existing);
  } catch (err) {
    console.error('[api/webflow-form] write failed:', err);
    return NextResponse.json({ ok: false, error: 'storage error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: record.id });
}

export async function GET() {
  // Convenience health check for the webhook URL.
  return NextResponse.json({ ok: true, endpoint: 'webflow-form', method: 'POST' });
}
