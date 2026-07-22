// Roll every per-source file up into a single dashboard.json that /api/data
// serves verbatim. This is the real aggregator used in production once the
// ETL crons are pulling live data. When no real data exists yet, /api/data
// transparently falls back to mock so previews still look complete.
// Standalone: `node etl/aggregate.js`
import { readJSON, writeJSON, readCollection } from './_lib.js';
import { qualifyCalls } from './callrail.js';
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
function normalizeUTM(rawSource, rawMedium) {
  let s = String(rawSource || '').trim().toLowerCase();
  let m = String(rawMedium || '').trim().toLowerCase();
  if (m === '(none)') m = '';
  if (s === '(direct)') s = '';
  if (!m) {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 2 && KNOWN_MEDIA.has(parts[1])) {
      s = parts[0];
      m = parts[1];
    }
  }
  return { source: s || '(direct)', medium: m || '(none)' };
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
    const { source, medium } = normalizeUTM(r.utm_source, r.utm_medium);
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
    const { source, medium } = normalizeUTM(r.utm_source, r.utm_medium);
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
