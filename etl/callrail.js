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

// --- URL REDUCTION ----------------------------------------------------------
// CallRail stores the caller's full referrer and page URLs. We keep only the
// parts the dashboard reports — a referrer's host, a page's path — and drop
// query strings and fragments, which are where anything identifying would sit.

/** Bare hostname, or null. Rejects CallRail's "(direct)"-style sentinels. */
export function hostOf(raw) {
  const s = String(raw || '').trim();
  if (!s || /^\(.*\)$/.test(s)) return null;
  try {
    const h = new URL(s.includes('://') ? s : `https://${s}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

// The main site. A page on any OTHER host — the Unbounce PPC landers on
// learn.mastermindbehavior.com, say — keeps its host in the stored reference,
// because the host is the difference between a paid-only asset and an organic
// page. Dropping it collapsed both into one row and made a live Unbounce lander
// look like a 404 on www.
const PRIMARY_HOSTS = new Set(['mastermindbehavior.com']);
const isPrimaryHost = (h) => PRIMARY_HOSTS.has(h.replace(/^www\./, ''));

/** Page reference: "/areas-we-serve/lakewood" on the main site, or
 *  "learn.mastermindbehavior.com/aba-therapy-near-me-1" elsewhere. Query and
 *  fragment are always dropped. Returns null when there is nothing usable. */
export function pathOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const host = u.hostname.toLowerCase();
    return isPrimaryHost(host) ? path : `${host.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    const cut = s.split(/[?#]/)[0].replace(/\/+$/, '');
    return cut || null;
  }
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
      // source_name names the TRACKER, which for a session-level DNI pool is
      // the pool ("Website pool") and says nothing about where the caller came
      // from. The session attribution swap.js captures lives in source/medium/
      // campaign/keywords/referring_url/landing_page_url — a caller arriving
      // from Google organic has a referrer but no utm_* at all, so without
      // these the call is indistinguishable from an untracked one.
      //
      // gclid is deliberately NOT requested: it is a per-click identifier that
      // joins back to an individual ad click, and source/medium already tell us
      // the traffic is paid.
      fields:
        'id,start_time,direction,duration,answered,first_call,customer_name,customer_phone_number,source_name,tags,utm_source,utm_medium,utm_campaign,source,medium,campaign,keywords,referring_url,landing_page_url,last_requested_url,device_type',
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
    // --- session attribution (see the fields comment above) ---
    cr_source: c.source || null,
    cr_medium: c.medium || null,
    cr_campaign: c.campaign || null,
    cr_keyword: c.keywords || null,
    // URLs are reduced before storage: the host of a referrer and the path of a
    // page are what the dashboard reports, and a query string is the part that
    // could carry something identifying.
    cr_referrer_host: hostOf(c.referring_url),
    cr_landing_path: pathOf(c.landing_page_url),
    cr_last_path: pathOf(c.last_requested_url),
    cr_device: c.device_type || null,
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
