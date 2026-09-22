// Roll every per-source file up into a single dashboard.json that /api/data
// serves verbatim. This is the real aggregator used in production once the
// ETL crons are pulling live data. When no real data exists yet, /api/data
// transparently falls back to mock so previews still look complete.
// Standalone: `node etl/aggregate.js`
import { readJSON, writeJSON, readCollection } from './_lib.js';
import { qualifyCalls, hostOf } from './callrail.js';
import { ALLOWED_LOCATION_IDS } from './gbp.js';
import { isMain } from './_run.js';

const GBP_ALLOWED = new Set(ALLOWED_LOCATION_IDS);

const DAYS = 180;

function emptyTimeline() {
  const points = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    points.push({
      date: d.toISOString().slice(0, 10),
      callrail: 0,
      callrailAll: 0,
      callrailFirst: 0,
      forms: 0,
      leadtrap: 0,
      email: 0,
      gbp: 0,
      ga4Sessions: 0,
    });
  }
  return points;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

// Canonicalize a UTM (source, medium) pair so the same traffic doesn't split
// into near-duplicate rows. Trims/lowercases, and when the medium is blank but
// the source string actually carries it ("google organic" → source "google",
// medium "organic"), splits it back out. Only splits on a recognized medium so
// legitimate multi-word/underscore sources (e.g. "facebook_all") are untouched.
const KNOWN_MEDIA = new Set([
  'organic', 'cpc', 'ppc', 'paid', 'search', 'referral', 'email', 'social', 'display', 'affiliate', 'video',
]);

// Our own domain(s). A "referral" from ourselves is a session artifact (a
// visitor bouncing through our own pages), not an acquisition source, so it
// collapses to (direct) rather than inventing a referrer.
const SELF_DOMAINS = ['mastermindbehavior.com'];
const isSelfDomain = (host) =>
  SELF_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

export function normalizeUTM(rawSource, rawMedium) {
  let s = String(rawSource || '').trim().toLowerCase();
  let m = String(rawMedium || '').trim().toLowerCase();
  if (m === '(none)') m = '';
  if (s === '(direct)') s = '';

  // Leadtrap has no utm_* fields, so the webhook passes its Source label
  // straight through — "Direct", "Referral (www.example.com)". Unwrap those
  // into real source/medium pairs instead of leaving them as pseudo-sources.
  const ref = s.match(/^referral\s*\(([^)]+)\)$/);
  if (ref) {
    const host = ref[1].trim().replace(/^www\./, '');
    if (isSelfDomain(host)) {
      s = ''; // self-referral → (direct)
    } else {
      s = host; // a real referrer keeps its host, with referral as the medium
      m = m || 'referral';
    }
  }
  // "direct"/"none" as a literal source are the same bucket as the (direct)
  // sentinel — fold them so the same traffic doesn't split across two rows.
  if (s === 'direct' || s === 'none') s = '';

  if (!m) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 2 && KNOWN_MEDIA.has(parts[1])) {
      s = parts[0];
      m = parts[1];
    }
  }
  return { source: s || '(direct)', medium: m || '(none)' };
}

// --- ATTRIBUTION FALLBACK ---------------------------------------------------
// utm_* are only present when a campaign tagged the visit. A caller who found
// the site through Google organic has a referrer but no utm_* at all, so
// normalizeUTM alone files them under (direct)/(none) — which read as "we
// couldn't track it" when the truth was "nothing tagged it".
//
// Both CallRail and the forms tracker persist attribution alongside those
// empty utm_* fields. This resolves a lead's real source/medium by falling
// back through what each channel actually stores, in order of confidence, and
// is the single place the dashboard decides what a lead's source is.

// CallRail swap-POOL labels. A pool is a set of DNI numbers, not a traffic
// source: "Website pool" means the number was swapped in for a site visitor,
// which tells us nothing about how that visitor arrived.
const isPoolLabel = (label) => /\bpool\b/.test(String(label || '').toLowerCase());

// Sentinels the trackers write when they have nothing. Treating these as values
// invents sources that don't exist (a literal "(direct)" parses as a hostname).
const NULL_SIGNALS = new Set(['', '(direct)', '(none)', 'direct', 'none', 'unknown', 'null', '-']);
const isNullSignal = (v) => NULL_SIGNALS.has(String(v ?? '').trim().toLowerCase());

const SEARCH_HOSTS = ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave'];

// CallRail names its sources with the medium baked in — "Google Ads", "Google
// Organic", "Bing Organic". Left alone those become their own rows, so the
// same traffic splits: "google ads / cpc" sitting next to the "google / cpc"
// that campaign-tagged visits produce, and "google organic / organic" saying
// organic twice. Peel the trailing medium word off the source and let it stand
// as the medium when CallRail didn't give one.
const MEDIUM_WORDS = new Set(['ads', 'organic', 'paid', 'cpc', 'ppc', 'search']);

function vendorAttribution(rawSource, rawMedium) {
  const s = String(rawSource || '')
    .trim()
    .toLowerCase()
    // "Google Ads Click-2-Call" is Google Ads; which product placed the call is
    // already carried by the tracker name.
    .replace(/\s+click-?2-?call$/, '');
  const parts = s.split(/\s+/).filter(Boolean);
  let hint = '';
  while (parts.length > 1 && MEDIUM_WORDS.has(parts[parts.length - 1])) {
    hint = parts.pop();
  }
  const medium =
    String(rawMedium || '').trim().toLowerCase() || (hint === 'ads' ? 'cpc' : hint);
  return normalizeUTM(parts.join(' '), medium);
}

function hostToSource(host) {
  if (!host || isSelfDomain(host)) return null;
  const engine = SEARCH_HOSTS.find(
    (k) => host === k || host.startsWith(`${k}.`) || host.includes(`.${k}.`)
  );
  return engine
    ? { source: engine, medium: 'organic' }
    : { source: host, medium: 'referral' };
}

/** A lead's source/medium, using the channel's own attribution when utm_* are
 *  absent. Returns the (direct)/(none) sentinel pair only when nothing knows. */
export function resolveAttribution(r) {
  const primary = normalizeUTM(r.utm_source, r.utm_medium);
  if (primary.source !== '(direct)' || primary.medium !== '(none)') return primary;

  // CallRail's own session attribution — an explicit source/medium pair.
  if (!isNullSignal(r.cr_source) && !isPoolLabel(r.cr_source)) {
    const n = vendorAttribution(r.cr_source, r.cr_medium);
    if (n.source !== '(direct)') return n;
  }

  // A click id is unambiguous paid traffic.
  if (r.gclid) return { source: 'google', medium: 'cpc' };
  if (r.msclkid) return { source: 'bing', medium: 'cpc' };
  if (r.fbclid) return { source: 'facebook', medium: 'paid' };

  // The forms tracker stores a full referrer URL in first_touch_source, so
  // resolve it by host before treating it as a plain token.
  if (!isNullSignal(r.first_touch_source)) {
    const viaHost = hostToSource(hostOf(r.first_touch_source));
    if (viaHost) return viaHost;
    if (!String(r.first_touch_source).includes('://')) {
      const n = normalizeUTM(r.first_touch_source, null);
      if (n.source !== '(direct)') return n;
    }
  }

  // Last resort: the referring host (CallRail stores it pre-reduced).
  const viaReferrer = hostToSource(r.cr_referrer_host || hostOf(r.referrer));
  if (viaReferrer) return viaReferrer;

  return primary;
}

function sumLast(timeline, key, days) {
  return timeline.slice(-days).reduce((a, p) => a + (p[key] || 0), 0);
}

export async function aggregate() {
  const [callrail, forms, gbp, ga4, leadtrap, email] = await Promise.all([
    readJSON('callrail.json', []),
    readJSON('forms.json', []),
    readJSON('gbp.json', []),
    readJSON('ga4.json', []),
    // Leadtrap and Email are webhook-fed, stored one immutable blob per lead.
    readCollection('leadtrap'),
    readCollection('email'),
  ]);

  const timeline = emptyTimeline();
  const index = new Map(timeline.map((p) => [p.date, p]));
  const bump = (date, key, n = 1) => {
    const p = index.get(date);
    if (p) p[key] += n;
  };

  // Phone-lead counting is GATED behind CALLRAIL_QUALIFY. Default (unset) = RAW
  // counts: every CallRail record is a lead (the long-standing behavior). The
  // qualification (inbound + answered + first-time + IVR-adjusted duration bar,
  // deduped by caller number — see etl/callrail.js) applies ONLY when
  // CALLRAIL_QUALIFY=1, which stays OFF in production until the client
  // verification session locks the real IVR timing + deny-list. Turning it on
  // later is a deliberate one-flag change, its own client-facing moment.
  const QUALIFY = process.env.CALLRAIL_QUALIFY === '1';
  const leadCalls = QUALIFY ? qualifyCalls(callrail) : callrail;
  // Funnel context (always computed; only surfaced in the UI when QUALIFY is on).
  callrail.forEach((c) => {
    if (c.direction && c.direction !== 'inbound') return;
    bump(dayKey(c.timestamp), 'callrailAll');
    if (c.first_call !== false) bump(dayKey(c.timestamp), 'callrailFirst');
  });
  leadCalls.forEach((c) => bump(dayKey(c.timestamp), 'callrail'));
  forms.forEach((f) => bump(dayKey(f.timestamp || f.submittedAt), 'forms'));
  leadtrap.forEach((l) => bump(dayKey(l.timestamp), 'leadtrap'));
  email.forEach((e) => bump(dayKey(e.timestamp), 'email'));
  // GBP: only the four allowlisted profiles. GBP's single intent signal is
  // CALL_CLICKS (tap-to-call); website clicks/directions/impressions are
  // engagement/visibility, never counted as leads (see etl/gbp.js).
  const gbpRows = gbp.filter((g) => GBP_ALLOWED.has(g.location_id));
  gbpRows.forEach((g) => bump(g.date, 'gbp', g.calls || 0));
  ga4.forEach((s) => bump(s.date, 'ga4Sessions', s.sessions || 0));

  // --- summary + channel mix ---
  const callrail30 = sumLast(timeline, 'callrail', 30);
  const forms30 = sumLast(timeline, 'forms', 30);
  const leadtrap30 = sumLast(timeline, 'leadtrap', 30);
  const email30 = sumLast(timeline, 'email', 30);
  // gbp30 is GBP profile CALLS (calls only) — the intent signal, surfaced as its
  // own components block. GBP does NOT feed Total Leads (client decision): the
  // headline counts CallRail + Forms + Leadtrap + Email only.
  const gbpCalls30 = sumLast(timeline, 'gbp', 30);
  const totalLeads30d = callrail30 + forms30 + leadtrap30 + email30;

  const mixRaw = [
    { channel: 'CallRail', count: callrail30 },
    { channel: 'Forms', count: forms30 },
    { channel: 'GBP Calls', count: gbpCalls30 },
    { channel: 'Leadtrap', count: leadtrap30 },
    { channel: 'Email', count: email30 },
  ];
  const mixTotal = mixRaw.reduce((a, c) => a + c.count, 0) || 1;
  const channelMix = mixRaw
    .map((c) => ({ ...c, pct: Math.round((c.count / mixTotal) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);

  // --- UTM raw rows (within the 180-day window) for arbitrary-period views ---
  const recent = (ts) =>
    new Date(ts).getTime() >= Date.now() - 30 * 86400000;
  const utmRecords = [];
  const taggedByChannel = [
    ...leadCalls.map((r) => ['callrail', r]),
    ...forms.map((r) => ['forms', r]),
    ...leadtrap.map((r) => ['leadtrap', r]),
    ...email.map((r) => ['email', r]),
  ];
  taggedByChannel.forEach(([channel, r]) => {
    const ts = r.timestamp || r.submittedAt;
    if (!ts) return;
    const date = dayKey(ts);
    if (!index.has(date)) return; // only within the 180-day window
    const { source, medium } = resolveAttribution(r);
    utmRecords.push({
      date,
      source,
      medium,
      channel, // backend-only: lets us split "(direct)" by calls vs forms
    });
  });
  // utmSources keeps a 30-day breakdown for any legacy consumer.
  const last30Dates = new Set(timeline.slice(-30).map((p) => p.date));
  const utm30 = new Map();
  utmRecords.forEach((r) => {
    if (!last30Dates.has(r.date)) return;
    const key = `${r.source}|${r.medium}`;
    utm30.set(key, (utm30.get(key) || 0) + 1);
  });
  const utmSources = [...utm30.entries()]
    .map(([k, count]) => {
      const [source, medium] = k.split('|');
      return { source, medium, count };
    })
    .sort((a, b) => b.count - a.count);

  // --- source/medium timeline (daily counts per combo, top combos + Other) ---
  const comboLabel = (r) => {
    const { source, medium } = resolveAttribution(r);
    return `${source} / ${medium}`;
  };
  const comboTotals = new Map();
  const comboByDate = new Map(); // date -> Map(combo -> count)
  [...leadCalls, ...forms, ...leadtrap, ...email].forEach((r) => {
    const ts = r.timestamp || r.submittedAt;
    if (!ts) return;
    const date = dayKey(ts);
    if (!index.has(date)) return; // only within the 180-day window
    const combo = comboLabel(r);
    comboTotals.set(combo, (comboTotals.get(combo) || 0) + 1);
    if (!comboByDate.has(date)) comboByDate.set(date, new Map());
    const dm = comboByDate.get(date);
    dm.set(combo, (dm.get(combo) || 0) + 1);
  });
  const topCombos = [...comboTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c]) => c);
  const hasOther = comboTotals.size > topCombos.length;
  const utmSeries = topCombos.map((c) => ({ key: c, name: c }));
  if (hasOther) utmSeries.push({ key: 'Other', name: 'Other' });
  const utmTimeline = timeline.map((p) => {
    const row = { date: p.date };
    topCombos.forEach((c) => (row[c] = 0));
    if (hasOther) row.Other = 0;
    const dm = comboByDate.get(p.date);
    if (dm) {
      for (const [combo, count] of dm.entries()) {
        if (topCombos.includes(combo)) row[combo] += count;
        else if (hasOther) row.Other += count;
      }
    }
    return row;
  });

  // --- form-level detail ---
  const formMap = new Map();
  forms.forEach((f) => {
    const ts = f.timestamp || f.submittedAt;
    if (ts && !recent(ts)) return;
    let name = f.formName || f.form || 'Unknown Form';
    // Legacy fix: early webhook records stored the submitter's name in formName.
    if (name === f.name) name = 'Contact Us';
    formMap.set(name, (formMap.get(name) || 0) + 1);
  });
  const formRows = [...formMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // --- GBP per-location + per-state (last 30 days, summed, allowlist only) ---
  // Components only — no summed "leads" figure. Calls (tap-to-call) is the intent
  // signal; website clicks/directions/impressions are engagement/visibility.
  const recentGbp = gbpRows.filter((g) => g.date && recent(`${g.date}T00:00:00Z`));
  const locMap = new Map();
  const stateMap = new Map();
  recentGbp.forEach((g) => {
    const cityName = `${g.city}${g.state ? `, ${g.state}` : ''}`;
    const loc = locMap.get(cityName) || {
      name: cityName,
      state: g.state || null,
      location_id: g.location_id,
      status: 'active',
      calls: 0,
      websiteClicks: 0,
      directions: 0,
      impressions: 0,
    };
    loc.calls += g.calls || 0;
    loc.websiteClicks += g.websiteClicks || 0;
    loc.directions += g.directions || 0;
    loc.impressions += g.impressions || 0;
    locMap.set(cityName, loc);

    const st = g.state || 'Unknown';
    const state = stateMap.get(st) || {
      state: st,
      locations: new Set(),
      calls: 0,
      websiteClicks: 0,
      directions: 0,
      impressions: 0,
    };
    state.locations.add(g.location_id);
    state.calls += g.calls || 0;
    state.websiteClicks += g.websiteClicks || 0;
    state.directions += g.directions || 0;
    state.impressions += g.impressions || 0;
    stateMap.set(st, state);
  });
  const gbpLocations = [...locMap.values()].sort((a, b) => b.calls - a.calls);
  const gbpStates = [...stateMap.values()]
    .map((s) => ({ ...s, locations: s.locations.size }))
    .sort((a, b) => b.calls - a.calls);

  // --- source status ---
  const status = (arr, pendingLabel) =>
    arr.length > 0 ? 'connected' : pendingLabel;
  const sources = [
    { key: 'callrail', label: 'CallRail', status: status(callrail, 'no_data') },
    { key: 'forms', label: 'Webflow Forms', status: status(forms, 'no_data') },
    { key: 'gbp', label: 'Google Business Profile', status: status(gbp, 'pending') },
    { key: 'ga4', label: 'GA4', status: status(ga4, 'no_data') },
    { key: 'leadtrap', label: 'Leadtrap', status: status(leadtrap, 'pending') },
    { key: 'email', label: 'Email', status: status(email, 'pending') },
  ];

  // --- per-call attribution rows for the Call Sources section ---------------
  // One row per call within the 180-day window, carrying the resolved source
  // plus the dimensions that explain where the call came from. Deliberately
  // nothing identifying: no call id, caller name, or phone number — and URLs
  // arrive already reduced to host/path by etl/callrail.js.
  const callRecords = [];
  leadCalls.forEach((c) => {
    if (!c.timestamp) return;
    const date = dayKey(c.timestamp);
    if (!index.has(date)) return;
    const { source, medium } = resolveAttribution(c);
    callRecords.push({
      date,
      source,
      medium,
      campaign: c.cr_campaign || null,
      keyword: c.cr_keyword || null,
      landing: c.cr_landing_path || null,
      device: (c.cr_device || '').toLowerCase() || null,
      // The tracker the call came in on — a pool name means a website visitor,
      // a named line (e.g. Google My Business) means an offline/listing call.
      tracker: c.tracking_source || null,
    });
  });

  return {
    lastUpdated: new Date().toISOString(),
    summary: {
      totalLeads30d,
      callrailCalls30d: callrail30,
      formSubmissions30d: forms30,
      gbpCalls30d: gbpCalls30,
    },
    // Drives the CallRail summary card: funnel when qualification is on, single
    // raw-count card when off.
    callrailQualified: QUALIFY,
    timeline,
    channelMix,
    utmSources,
    utmRecords,
    utmTimeline,
    utmSeries,
    callRecords,
    forms: formRows,
    gbpLocations,
    gbpStates,
    sources,
    isMock: false,
  };
}

if (isMain(import.meta.url)) {
  aggregate()
    .then((dashboard) => writeJSON('dashboard.json', dashboard).then(() => dashboard))
    .then((dashboard) =>
      console.log(
        `[etl:aggregate] wrote dashboard.json (totalLeads30d=${dashboard.summary.totalLeads30d})`
      )
    )
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
