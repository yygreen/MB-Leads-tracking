// Calendly API v2 pull.
//   env: CALENDLY_API_KEY (personal access token)
// Standalone: `node etl/calendly.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain, daysAgoISO } from './_run.js';

export async function pull() {
  const token = process.env.CALENDLY_API_KEY;
  if (!token) {
    warnMissingEnv('calendly', ['CALENDLY_API_KEY']);
    return [];
  }
  const headers = { Authorization: `Bearer ${token}` };

  // 1. Resolve the current user so we can scope the events query.
  const meRes = await fetch('https://api.calendly.com/users/me', { headers });
  if (!meRes.ok) {
    console.error(`[etl:calendly] users/me ${meRes.status}`);
    return [];
  }
  const me = await meRes.json();
  const userUri = me.resource.uri;

  // 2. Pull scheduled events for the last 180 days.
  const params = new URLSearchParams({
    user: userUri,
    min_start_time: `${daysAgoISO(180)}T00:00:00Z`,
    count: '100',
    status: 'active',
  });
  const evRes = await fetch(
    `https://api.calendly.com/scheduled_events?${params}`,
    { headers }
  );
  if (!evRes.ok) {
    console.error(`[etl:calendly] scheduled_events ${evRes.status}`);
    return [];
  }
  const body = await evRes.json();

  return (body.collection || []).map((e) => ({
    source: 'calendly',
    id: e.uri,
    timestamp: e.start_time,
    event_type: e.name,
    status: e.status,
    location: e.location?.type || null,
  }));
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('calendly.json', records).then(() => records))
    .then((records) => console.log(`[etl:calendly] wrote ${records.length} records`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
