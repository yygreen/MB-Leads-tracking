// Google Business Profile — Performance API pull with OAuth refresh.
//   env: GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REFRESH_TOKEN, GBP_LOCATION_IDS
//        (GBP_LOCATION_IDS = comma-separated location resource names or ids)
// Standalone: `node etl/gbp.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain } from './_run.js';

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
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
  return (await res.json()).access_token;
}

// Daily metric time series for a single location over the last 180 days.
async function fetchLocationMetrics(locationId, accessToken) {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 180);

  const metrics = [
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  ];
  const params = new URLSearchParams();
  metrics.forEach((m) => params.append('dailyMetrics', m));
  params.set('dailyRange.start_date.year', String(start.getUTCFullYear()));
  params.set('dailyRange.start_date.month', String(start.getUTCMonth() + 1));
  params.set('dailyRange.start_date.day', String(start.getUTCDate()));
  params.set('dailyRange.end_date.year', String(end.getUTCFullYear()));
  params.set('dailyRange.end_date.month', String(end.getUTCMonth() + 1));
  params.set('dailyRange.end_date.day', String(end.getUTCDate()));

  const name = locationId.startsWith('locations/')
    ? locationId
    : `locations/${locationId}`;
  const url = `https://businessprofileperformance.googleapis.com/v1/${name}:fetchMultiDailyMetricsTimeSeries?${params}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    console.error(`[etl:gbp] ${name} ${res.status}: ${await res.text()}`);
    return [];
  }
  const body = await res.json();

  // Flatten the multi-metric time series into one record per (location, date).
  const byDate = {};
  for (const series of body.multiDailyMetricTimeSeries || []) {
    for (const mts of series.dailyMetricTimeSeries || []) {
      const metric = mts.dailyMetric;
      for (const dv of mts.timeSeries?.datedValues || []) {
        const date = `${dv.date.year}-${String(dv.date.month).padStart(2, '0')}-${String(dv.date.day).padStart(2, '0')}`;
        byDate[date] ??= { date, calls: 0, directions: 0, websiteClicks: 0, impressions: 0 };
        const v = Number(dv.value || 0);
        if (metric === 'CALL_CLICKS') byDate[date].calls += v;
        else if (metric === 'BUSINESS_DIRECTION_REQUESTS') byDate[date].directions += v;
        else if (metric === 'WEBSITE_CLICKS') byDate[date].websiteClicks += v;
        else if (metric.startsWith('BUSINESS_IMPRESSIONS')) byDate[date].impressions += v;
      }
    }
  }
  return Object.values(byDate).map((r) => ({ source: 'gbp', location: name, ...r }));
}

export async function pull() {
  const clientId = process.env.GBP_CLIENT_ID;
  const clientSecret = process.env.GBP_CLIENT_SECRET;
  const refreshToken = process.env.GBP_REFRESH_TOKEN;
  const locationIds = process.env.GBP_LOCATION_IDS;
  if (!clientId || !clientSecret || !refreshToken || !locationIds) {
    warnMissingEnv('gbp', [
      'GBP_CLIENT_ID',
      'GBP_CLIENT_SECRET',
      'GBP_REFRESH_TOKEN',
      'GBP_LOCATION_IDS',
    ]);
    return [];
  }

  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });
  const ids = locationIds.split(',').map((s) => s.trim()).filter(Boolean);

  const out = [];
  for (const id of ids) {
    out.push(...(await fetchLocationMetrics(id, accessToken)));
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
