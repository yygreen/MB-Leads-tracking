// Roll every per-source file up into a single dashboard.json that /api/data
// serves verbatim. This is the real aggregator used in production once the
// ETL crons are pulling live data. When no real data exists yet, /api/data
// transparently falls back to mock so previews still look complete.
// Standalone: `node etl/aggregate.js`
import { readJSON, writeJSON } from './_lib.js';
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
      calendly: 0,
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
  const [callrail, forms, calendly, gbp, ga4, leadtrap] = await Promise.all([
    readJSON('callrail.json', []),
    readJSON('forms.json', []),
    readJSON('calendly.json', []),
    readJSON('gbp.json', []),
    readJSON('ga4.json', []),
    readJSON('leadtrap.json', []),
  ]);

  const timeline = emptyTimeline();
  const index = new Map(timeline.map((p) => [p.date, p]));
  const bump = (date, key, n = 1) => {
    const p = index.get(date);
    if (p) p[key] += n;
  };

  callrail.forEach((c) => bump(dayKey(c.timestamp), 'callrail'));
  forms.forEach((f) => bump(dayKey(f.timestamp || f.submittedAt), 'forms'));
  calendly.forEach((e) => bump(dayKey(e.timestamp), 'calendly'));
  leadtrap.forEach((l) => bump(dayKey(l.timestamp), 'leadtrap'));
  gbp.forEach((g) => bump(g.date, 'gbpCalls', g.calls || 0));
  ga4.forEach((s) => bump(s.date, 'ga4Sessions', s.sessions || 0));

  // --- summary + channel mix ---
  const callrail30 = sumLast(timeline, 'callrail', 30);
  const forms30 = sumLast(timeline, 'forms', 30);
  const calendly30 = sumLast(timeline, 'calendly', 30);
  const leadtrap30 = sumLast(timeline, 'leadtrap', 30);
  const gbpCalls30 = sumLast(timeline, 'gbpCalls', 30);
  const totalLeads30d = callrail30 + forms30 + calendly30 + leadtrap30 + gbpCalls30;

  const mixRaw = [
    { channel: 'CallRail', count: callrail30 },
    { channel: 'Forms', count: forms30 },
    { channel: 'GBP Calls', count: gbpCalls30 },
    { channel: 'Calendly', count: calendly30 },
    { channel: 'Leadtrap', count: leadtrap30 },
  ];
  const mixTotal = mixRaw.reduce((a, c) => a + c.count, 0) || 1;
  const channelMix = mixRaw
    .map((c) => ({ ...c, pct: Math.round((c.count / mixTotal) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);

  // --- UTM breakdown (from callrail + forms that carry utm fields) ---
  const utmMap = new Map();
  const recent = (ts) =>
    new Date(ts).getTime() >= Date.now() - 30 * 86400000;
  [...callrail, ...forms].forEach((r) => {
    const ts = r.timestamp || r.submittedAt;
    if (ts && !recent(ts)) return;
    const source = r.utm_source || '(direct)';
    const medium = r.utm_medium || '(none)';
    const key = `${source}|${medium}`;
    utmMap.set(key, (utmMap.get(key) || 0) + 1);
  });
  const utmSources = [...utmMap.entries()]
    .map(([k, count]) => {
      const [source, medium] = k.split('|');
      return { source, medium, count };
    })
    .sort((a, b) => b.count - a.count);

  // --- form-level detail ---
  const formMap = new Map();
  forms.forEach((f) => {
    const ts = f.timestamp || f.submittedAt;
    if (ts && !recent(ts)) return;
    const name = f.formName || f.form || 'Unknown Form';
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
    { key: 'calendly', label: 'Calendly', status: status(calendly, 'pending') },
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
