// Google Business Profile — discovery + Performance API pull with OAuth refresh.
//   env: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN
//        (OAuth user token with scope business.manage, Manager on the group)
//
// Location IDs are DISCOVERED at runtime via the Account Management + Business
// Information APIs — GBP_LOCATION_IDS is intentionally unused. Each discovered
// location is mapped to its city/state so the aggregate can roll up per-location
// AND per-state (NJ = Lakewood + Hackensack, GA = Macon + Warner Robins).
// Standalone: `node etl/gbp.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain } from './_run.js';

const GROUP_NAME = 'Mastermind Behavior All Locations';

// The four confirmed, managed profiles — keyed by their Performance-API
// location_id (verified via discovery on the live group). This is an EXPLICIT
// ALLOWLIST: only these four roll into the dashboard. A location the group
// returns that is NOT in this list is surfaced for review, never auto-summed,
// so a stray/duplicate/old listing can't silently inflate the numbers.
//   NJ = Lakewood + Hackensack   ·   GA = Macon + Warner Robins
// Match discovered locations by location_id first, then store code, then an
// address/title pattern (Lakewood has no store code).
const KNOWN_LOCATIONS = [
  { city: 'Macon', state: 'GA', location_id: '13129990522712001976', storeCode: '15994646695861665134', match: /presidential|\bmacon\b|31206/i },
  { city: 'Warner Robins', state: 'GA', location_id: '7522827089246541481', storeCode: '11885738727771819361', match: /watson|warner\s*robins|31093/i },
  { city: 'Lakewood', state: 'NJ', location_id: '6319645560586507966', storeCode: null, match: /monmouth|\blakewood\b|08701/i },
  { city: 'Hackensack', state: 'NJ', location_id: '4727786949203212697', storeCode: '08328327118053228886', match: /hackensack|07601/i },
];

// The allowlist itself — the only location_ids permitted into aggregate/rollup.
export const ALLOWED_LOCATION_IDS = KNOWN_LOCATIONS.map((k) => k.location_id);
const ALLOWED_SET = new Set(ALLOWED_LOCATION_IDS);

// GBP SIGNALS (locked with the client): GBP does NOT produce a summed "leads"
// figure — the word "lead" is reserved for the CallRail qualified-call channel.
// GBP surfaces its components. The single intent signal, where one is needed, is
// CALL_CLICKS (tap-to-call = trying to reach the business). Website clicks and
// direction requests are engagement; impressions are visibility — none are leads.
export function callSignal(rec) {
  return Number(rec?.calls) || 0;
}

const LEAD_METRICS = [
  'CALL_CLICKS', // tap-to-call — the GBP intent signal
  'WEBSITE_CLICKS', // engagement — NOT a lead
  'BUSINESS_DIRECTION_REQUESTS', // engagement (directions) — NOT a lead
  'BUSINESS_CONVERSATIONS', // off on these profiles — pulled for completeness only
];
const VISIBILITY_METRICS = [
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
];

// --- auth -------------------------------------------------------------------
export function gbpCreds() {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  const refreshToken = process.env.GBP_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`oauth token ${res.status}: ${await res.text()}`);
  const body = await res.json();
  // scope is returned on refresh; surface it so callers can verify business.manage
  return { accessToken: body.access_token, scope: body.scope || null };
}

// --- discovery --------------------------------------------------------------
async function listAccounts(accessToken) {
  const out = [];
  let pageToken = '';
  do {
    const url =
      `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`accounts.list ${res.status}: ${await res.text()}`);
    const body = await res.json();
    out.push(...(body.accounts || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function listLocations(accessToken, accountName) {
  const out = [];
  let pageToken = '';
  const readMask = 'name,title,storefrontAddress,storeCode';
  do {
    const url =
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations` +
      `?readMask=${encodeURIComponent(readMask)}&pageSize=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`locations.list ${res.status}: ${await res.text()}`);
    const body = await res.json();
    out.push(...(body.locations || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

function addressString(a) {
  if (!a) return '';
  return [
    (a.addressLines || []).join(' '),
    a.locality,
    a.administrativeArea,
    a.postalCode,
    a.regionCode,
  ]
    .filter(Boolean)
    .join(' ');
}

function mapLocation(loc) {
  const storeCode = loc.storeCode || null;
  const addr = addressString(loc.storefrontAddress);
  const id = String(loc.name || '').split('/').pop();
  // location_id is the ground truth (verified via discovery); fall back to store
  // code, then an address/title pattern, so city/state still resolve if Google
  // ever re-issues an id.
  let known = KNOWN_LOCATIONS.find((k) => k.location_id === id);
  if (!known && storeCode) known = KNOWN_LOCATIONS.find((k) => k.storeCode === storeCode);
  if (!known) known = KNOWN_LOCATIONS.find((k) => k.match.test(addr) || k.match.test(loc.title || ''));
  return {
    location_id: id,
    name: loc.name, // locations/{id} — the Performance API address
    title: loc.title || null,
    storeCode,
    address: addr,
    city: known?.city || loc.storefrontAddress?.locality || loc.title || 'Unknown',
    state: known?.state || loc.storefrontAddress?.administrativeArea || null,
    matched: Boolean(known),
  };
}

/** Resolve the group account + all its locations (mapped to city/state). */
export async function discover(accessToken) {
  const accounts = await listAccounts(accessToken);
  const group =
    accounts.find((a) => (a.accountName || '') === GROUP_NAME) ||
    accounts.find((a) => a.type === 'LOCATION_GROUP') ||
    accounts[0];
  if (!group) throw new Error('no accessible GBP accounts for this token');
  const locations = (await listLocations(accessToken, group.name)).map(mapLocation);
  return {
    account: { name: group.name, accountName: group.accountName || null, type: group.type || null },
    accountCandidates: accounts.map((a) => ({ name: a.name, accountName: a.accountName, type: a.type })),
    locations,
  };
}

/** Split discovered locations into the four allowed profiles and everything
 *  else. `stray` is surfaced (never summed) so a new/duplicate/old listing on
 *  the group gets reviewed before it can enter the numbers. */
export function partitionLocations(locations) {
  const allowed = locations.filter((l) => ALLOWED_SET.has(l.location_id));
  const stray = locations.filter((l) => !ALLOWED_SET.has(l.location_id));
  return { allowed, stray };
}

// --- metrics ----------------------------------------------------------------
function dateParts(prefix, d, params) {
  params.set(`${prefix}.year`, String(d.getUTCFullYear()));
  params.set(`${prefix}.month`, String(d.getUTCMonth() + 1));
  params.set(`${prefix}.day`, String(d.getUTCDate()));
}

// Performance API lags ~3 days and returns nothing for the most recent days, so
// the window ends at today − lagDays. Backfill by passing backfillTo=YYYY-MM-DD.
export function metricsWindow({ backfillTo = null, lagDays = 3, days = 180 } = {}) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - lagDays);
  let start;
  if (backfillTo) {
    start = new Date(`${backfillTo}T00:00:00Z`);
  } else {
    start = new Date(end);
    start.setUTCDate(start.getUTCDate() - days);
  }
  return { startDate: start, endDate: end };
}

/** Daily metrics for one discovered location over [startDate, endDate]. */
export async function fetchLocationMetrics(loc, accessToken, opts = {}) {
  const { startDate, endDate, includeVisibility = true } = opts;
  const metrics = includeVisibility ? [...LEAD_METRICS, ...VISIBILITY_METRICS] : LEAD_METRICS;
  const params = new URLSearchParams();
  metrics.forEach((m) => params.append('dailyMetrics', m));
  dateParts('dailyRange.start_date', startDate, params);
  dateParts('dailyRange.end_date', endDate, params);

  const url = `https://businessprofileperformance.googleapis.com/v1/${loc.name}:fetchMultiDailyMetricsTimeSeries?${params}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    console.error(`[etl:gbp] ${loc.name} ${res.status}: ${await res.text()}`);
    return [];
  }
  const body = await res.json();

  const byDate = {};
  for (const series of body.multiDailyMetricTimeSeries || []) {
    for (const mts of series.dailyMetricTimeSeries || []) {
      const metric = mts.dailyMetric;
      for (const dv of mts.timeSeries?.datedValues || []) {
        const date = `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`;
        byDate[date] ??= {
          date,
          calls: 0,
          websiteClicks: 0,
          directions: 0,
          conversations: 0,
          impressions: 0,
        };
        const v = Number(dv.value || 0);
        if (metric === 'CALL_CLICKS') byDate[date].calls += v;
        else if (metric === 'WEBSITE_CLICKS') byDate[date].websiteClicks += v;
        else if (metric === 'BUSINESS_DIRECTION_REQUESTS') byDate[date].directions += v;
        else if (metric === 'BUSINESS_CONVERSATIONS') byDate[date].conversations += v;
        else if (metric.startsWith('BUSINESS_IMPRESSIONS')) byDate[date].impressions += v; // visibility, not a lead
      }
    }
  }
  return Object.values(byDate).map((r) => ({
    source: 'gbp',
    location: loc.name,
    location_id: loc.location_id,
    city: loc.city,
    state: loc.state,
    ...r,
  }));
}

// --- full pull (used by the cron; only runs on approval/deploy) -------------
export async function pull() {
  const c = gbpCreds();
  if (!c) {
    warnMissingEnv('gbp', ['GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'GBP_REFRESH_TOKEN']);
    return [];
  }
  const { accessToken } = await getAccessToken(c);
  const { locations } = await discover(accessToken);
  // Only the four allowlisted profiles roll up; anything else is surfaced, not summed.
  const { allowed, stray } = partitionLocations(locations);
  if (stray.length) {
    console.warn(
      `[etl:gbp] ${stray.length} un-allowlisted location(s) skipped: ` +
        stray.map((s) => `${s.location_id} (${s.title || s.address || '?'})`).join('; ')
    );
  }
  // Backfill to Feb 2026 to align GBP history with the CallRail tracking window.
  const { startDate, endDate } = metricsWindow({ backfillTo: '2026-02-01' });
  const out = [];
  for (const loc of allowed) {
    out.push(...(await fetchLocationMetrics(loc, accessToken, { startDate, endDate })));
  }
  return out;
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('gbp.json', records).then(() => records))
    .then((records) => console.log(`[etl:gbp] wrote ${records.length} records`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
