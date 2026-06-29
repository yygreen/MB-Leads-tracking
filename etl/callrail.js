// CallRail API v3 pull.
//   env: CALLRAIL_API_KEY, CALLRAIL_ACCOUNT_ID
// Standalone: `node etl/callrail.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain, daysAgoISO } from './_run.js';

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
        'id,start_time,direction,duration,customer_name,customer_phone_number,source_name,utm_source,utm_medium,utm_campaign',
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
    // CallRail returns total_pages; fall back to a single page if absent.
    totalPages = Math.min(body.total_pages || 1, MAX_PAGES);
    page += 1;
  } while (page <= totalPages);

  return all.map((c) => ({
    source: 'callrail',
    id: String(c.id),
    timestamp: c.start_time,
    direction: c.direction,
    duration: c.duration,
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
