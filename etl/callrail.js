// CallRail API v3 pull + phone-lead qualification.
//   env: CALLRAIL_API_KEY, CALLRAIL_ACCOUNT_ID
//   optional: CALLRAIL_IVR_SECONDS (see QUALIFICATION below)
// Standalone: `node etl/callrail.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain, daysAgoISO } from './_run.js';

// --- QUALIFICATION CONFIG ---------------------------------------------------
// The IVR greeting + extension prompts consume the first part of every call,
// so raw duration overstates conversation time. A call only counts as a
// qualified phone lead if the caller spent >= 50s BEYOND the IVR.
// IVR_SECONDS is the measured length of the phone tree (set via env once
// timed; the default below is PROVISIONAL until then).
export const IVR_SECONDS = Number(process.env.CALLRAIL_IVR_SECONDS ?? 30);
export const MIN_CONVERSATION_SECONDS = 50;

// Numbers that must never count as leads (staff cells, telemarketers, the
// client's own lines). E.164 or bare-digit strings; matched on digits only.
export const DENY_LIST = [
  // '+15551234567',
];

const digits = (s) => String(s || '').replace(/\D/g, '');
const DENY_SET = new Set(DENY_LIST.map(digits).filter(Boolean));

/** True if a single call meets the qualified-phone-lead bar (before dedupe).
 *  Legacy records pulled before answered/first_call were captured are treated
 *  as answered first calls so historical data degrades gracefully. */
export function isQualifiedCall(c, ivrSeconds = IVR_SECONDS) {
  if (c.direction && c.direction !== 'inbound') return false;
  if (c.answered === false) return false;
  if (c.first_call === false) return false;
  if (DENY_SET.has(digits(c.customer_phone))) return false;
  return (Number(c.duration) || 0) >= ivrSeconds + MIN_CONVERSATION_SECONDS;
}

/** Filter + dedupe by caller number (earliest qualifying call wins).
 *  Calls with no caller number (blocked ID) can't be deduped and are kept. */
export function qualifyCalls(calls, ivrSeconds = IVR_SECONDS) {
  const sorted = [...calls].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  const seen = new Set();
  const out = [];
  for (const c of sorted) {
    if (!isQualifiedCall(c, ivrSeconds)) continue;
    const num = digits(c.customer_phone);
    if (num) {
      if (seen.has(num)) continue;
      seen.add(num);
    }
    out.push(c);
  }
  return out;
}

// --- PULL -------------------------------------------------------------------
export async function pull() {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  if (!apiKey || !accountId) {
    warnMissingEnv('callrail', ['CALLRAIL_API_KEY', 'CALLRAIL_ACCOUNT_ID']);
    return [];
  }

  const headers = { Authorization: `Token token="${apiKey}"` };
  const PER_PAGE = 250;
  const MAX_PAGES = 40; // safety cap (10k calls) against runaway pagination

  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const params = new URLSearchParams({
      fields:
        'id,start_time,direction,duration,answered,first_call,customer_name,customer_phone_number,source_name,tags,utm_source,utm_medium,utm_campaign',
      start_date: daysAgoISO(180),
      per_page: String(PER_PAGE),
      page: String(page),
    });
    const url = `https://api.callrail.com/v3/a/${accountId}/calls.json?${params}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`[etl:callrail] API ${res.status} (page ${page}): ${await res.text()}`);
      break;
    }
    const body = await res.json();
    all.push(...(body.calls || []));
    totalPages = Math.min(body.total_pages || 1, MAX_PAGES);
    page += 1;
  } while (page <= totalPages);

  return all.map((c) => ({
    source: 'callrail',
    id: String(c.id),
    timestamp: c.start_time,
    direction: c.direction,
    duration: c.duration,
    answered: c.answered,
    first_call: c.first_call,
    tags: Array.isArray(c.tags) ? c.tags.map((t) => t?.name ?? t) : [],
    customer_name: c.customer_name || null,
    customer_phone: c.customer_phone_number || null,
    tracking_source: c.source_name || null,
    utm_source: c.utm_source || null,
    utm_medium: c.utm_medium || null,
    utm_campaign: c.utm_campaign || null,
  }));
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('callrail.json', records).then(() => records))
    .then((records) => console.log(`[etl:callrail] wrote ${records.length} records`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
