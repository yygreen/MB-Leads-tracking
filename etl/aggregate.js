// Roll every per-source file up into a single dashboard.json that /api/data
// serves verbatim. This is the real aggregator used in production once the
// ETL crons are pulling live data. When no real data exists yet, /api/data
// transparently falls back to mock so previews still look complete.
// Standalone: `node etl/aggregate.js`
import { readJSON, writeJSON, readCollection } from './_lib.js';
import { isMain } from './_run.js';

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
      forms: 0,
      leadtrap: 0,
      gbpCalls: 0,
      ga4Sessions: 0,
    });
  }
  return points;
}

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function sumLast(timeline, key, days) {
  return timeline.slice(-days).reduce((a, p) => a + (p[key] || 0), 0);
}

export async function aggregate() {
  const [callrail, forms, gbp, ga4, leadtrap] = await Promise.all([
    readJSON('callrail.json', []),
    readJSON('forms.json', []),
    readJSON('gbp.json', []),
    readJSON('ga4.json', []),
    // Leadtrap is webhook-fed, stored one immutable blob per lead.
    readCollection('leadtrap'),
  ]);

  const timeline = emptyTimeline();
  const index = new Map(timeline.map((p) => [p.date, p]));
  const bump = (date, key, n = 1) => {
    const p = index.get(date);
    if (p) p[key] += n;
  };

  callrail.forEach((c) => bump(dayKey(c.timestamp), 'callrail'));
  forms.forEach((f) => bump(dayKey(f.timestamp || f.submittedAt), 'forms'));
  leadtrap.forEach((l) => bump(dayKey(l.timestamp), 'leadtrap'));
  gbp.forEach((g) => bump(g.date, 'gbpCalls', g.calls || 0));
  ga4.forEach((s) => bump(s.date, 'ga4Sessions', s.sessions || 0));

  // --- summary + channel mix ---
  const callrail30 = sumLast(timeline, 'callrail', 30);
  const forms30 = sumLast(timeline, 'forms', 30);
  const leadtrap30 = sumLast(timeline, 'leadtrap', 30);
  const gbpCalls30 = sumLast(timeline, 'gbpCalls', 30);
  const totalLeads30d = callrail30 + forms30 + leadtrap30 + gbpCalls30;

  const mixRaw = [
    { channel: 'CallRail', count: callrail30 },
    { channel: 'Forms', count: forms30 },
    { channel: 'GBP Calls', count: gbpCalls30 },
    { channel: 'Leadtrap', count: leadtrap30 },
  ];
  const mixTotal = mixRaw.reduce((a, c) => a + c.count, 0) || 1;
  const channelMix = mixRaw
    .map((c) => ({ ...c, pct: Math.round((c.count / mixTotal) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);

  // --- UTM breakdown by window (from callrail + forms + leadtrap) ---
  const recent = (ts) =>
    new Date(ts).getTime() >= Date.now() - 30 * 86400000;
  const utmRecords = [...callrail, ...forms, ...leadtrap];
  const utmBreakdown = (days) => {
    const cutoff = Date.now() - days * 86400000;
    const m = new Map();
    utmRecords.forEach((r) => {
      const ts = r.timestamp || r.submittedAt;
      if (!ts || new Date(ts).getTime() < cutoff) return;
      const source = r.utm_source || '(direct)';
      const medium = r.utm_medium || '(none)';
      const key = `${source}|${medium}`;
      m.set(key, (m.get(key) || 0) + 1);
    });
    return [...m.entries()]
      .map(([k, count]) => {
        const [source, medium] = k.split('|');
        return { source, medium, count };
      })
      .sort((a, b) => b.count - a.count);
  };
  const utmSourcesByWindow = {
    '30': utmBreakdown(30),
    '90': utmBreakdown(90),
    '180': utmBreakdown(180),
  };
  const utmSources = utmSourcesByWindow['30'];

  // --- source/medium timeline (daily counts per combo, top combos + Other) ---
  const comboLabel = (r) =>
    `${r.utm_source || '(direct)'} / ${r.utm_medium || '(none)'}`;
  const comboTotals = new Map();
  const comboByDate = new Map(); // date -> Map(combo -> count)
  [...callrail, ...forms, ...leadtrap].forEach((r) => {
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

  // --- GBP per-location (last 30 days, summed) ---
  const locMap = new Map();
  gbp.forEach((g) => {
    if (g.date && !recent(`${g.date}T00:00:00Z`)) return;
    const cur = locMap.get(g.location) || {
      name: g.location,
      status: 'active',
      calls: 0,
      directions: 0,
      websiteClicks: 0,
      impressions: 0,
    };
    cur.calls += g.calls || 0;
    cur.directions += g.directions || 0;
    cur.websiteClicks += g.websiteClicks || 0;
    cur.impressions += g.impressions || 0;
    locMap.set(g.location, cur);
  });
  const gbpLocations = [...locMap.values()];

  // --- source status ---
  const status = (arr, pendingLabel) =>
    arr.length > 0 ? 'connected' : pendingLabel;
  const sources = [
    { key: 'callrail', label: 'CallRail', status: status(callrail, 'no_data') },
    { key: 'forms', label: 'Webflow Forms', status: status(forms, 'no_data') },
    { key: 'gbp', label: 'Google Business Profile', status: status(gbp, 'pending') },
    { key: 'ga4', label: 'GA4', status: status(ga4, 'no_data') },
    { key: 'leadtrap', label: 'Leadtrap', status: status(leadtrap, 'pending') },
  ];

  return {
    lastUpdated: new Date().toISOString(),
    summary: {
      totalLeads30d,
      callrailCalls30d: callrail30,
      formSubmissions30d: forms30,
      gbpDirectCalls30d: gbpCalls30,
    },
    timeline,
    channelMix,
    utmSources,
    utmSourcesByWindow,
    utmTimeline,
    utmSeries,
    forms: formRows,
    gbpLocations,
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
