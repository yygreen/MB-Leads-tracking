// GA4 Data API pull via service account.
//   env: GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_JSON (base64-encoded key JSON)
// Standalone: `node etl/ga4.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain } from './_run.js';

export async function pull() {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const saB64 = process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (!propertyId || !saB64) {
    warnMissingEnv('ga4', ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_JSON']);
    return [];
  }

  let credentials;
  try {
    credentials = JSON.parse(Buffer.from(saB64, 'base64').toString('utf8'));
  } catch (err) {
    console.error('[etl:ga4] GA4_SERVICE_ACCOUNT_JSON is not valid base64 JSON');
    return [];
  }

  const { google } = await import('googleapis');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  const analyticsData = google.analyticsdata({ version: 'v1beta', auth });

  const res = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody: {
      dateRanges: [{ startDate: '180daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }],
    },
  });

  return (res.data.rows || []).map((row) => {
    const raw = row.dimensionValues?.[0]?.value || ''; // YYYYMMDD
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return {
      source: 'ga4',
      date,
      channel: row.dimensionValues?.[1]?.value || 'Unassigned',
      sessions: Number(row.metricValues?.[0]?.value || 0),
    };
  });
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('ga4.json', records).then(() => records))
    .then((records) => console.log(`[etl:ga4] wrote ${records.length} records`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
