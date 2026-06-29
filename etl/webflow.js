// Webflow Forms API pull — backfills historical submissions and keeps them
// fresh (the Zapier webhook only captures going forward; this fills the past
// and is a reliable ongoing source that doesn't depend on Zapier).
//   env: WEBFLOW_API_TOKEN  (scopes: forms:read, sites:read)
//        WEBFLOW_SITE_ID    (optional — auto-discovered from the token if absent)
// Standalone: `node etl/webflow.js`
import { writeJSON, warnMissingEnv } from './_lib.js';
import { isMain } from './_run.js';

const BASE = 'https://api.webflow.com/v2';
const DAYS = 180;

async function wf(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Webflow ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Webflow returns formResponse as { "Field Name": value }. Values may be a
// plain string or an object with a `.value`. These helpers pull a field by
// fuzzy (visible fields) or exact-lowercase (hidden attribution fields) match.
function val(v) {
  return v && typeof v === 'object' && 'value' in v ? v.value : v;
}
function fuzzy(resp, patterns) {
  const entries = Object.entries(resp || {});
  for (const pat of patterns) {
    const hit = entries.find(([k]) => pat.test(k));
    if (hit) return val(hit[1]) ?? null;
  }
  return null;
}
function exact(resp, key) {
  if (!resp) return null;
  const k = Object.keys(resp).find((x) => x.toLowerCase() === key);
  return k ? (val(resp[k]) ?? null) : null;
}

// The submission date has been named differently across Webflow API versions;
// read whichever is present so timestamps always resolve.
const DATE_KEYS = [
  'dateSubmitted',
  'dateCreated',
  'createdOn',
  'created-on',
  'submittedAt',
  'date',
  'lastUpdated',
  'updatedOn',
];
function submittedAt(s) {
  for (const k of DATE_KEYS) {
    if (s && s[k]) return s[k];
  }
  return null;
}

async function resolveSiteId(token) {
  if (process.env.WEBFLOW_SITE_ID) return process.env.WEBFLOW_SITE_ID;
  const { sites } = await wf('/sites', token);
  const list = sites || [];
  const match =
    list.find(
      (s) =>
        /mastermind/i.test(s.shortName || '') ||
        /mastermind/i.test(s.displayName || '') ||
        (s.customDomains || []).some((d) => /mastermind/i.test(d.url || ''))
    ) || list[0];
  return match ? match.id : null;
}

export async function pull() {
  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) {
    warnMissingEnv('webflow', ['WEBFLOW_API_TOKEN']);
    return [];
  }

  const siteId = await resolveSiteId(token);
  if (!siteId) {
    console.error('[etl:webflow] no site found for this token');
    return [];
  }

  const { forms } = await wf(`/sites/${siteId}/forms`, token);
  const cutoff = Date.now() - DAYS * 86400000;
  const out = [];

  for (const form of forms || []) {
    let offset = 0;
    const limit = 100;
    for (let page = 0; page < 50; page++) {
      const data = await wf(
        `/forms/${form.id}/submissions?limit=${limit}&offset=${offset}`,
        token
      );
      const subs = data.formSubmissions || data.submissions || [];
      for (const s of subs) {
        const ts = submittedAt(s);
        if (ts && new Date(ts).getTime() < cutoff) continue;
        const r = s.formResponse || s.data || s.payload || {};
        out.push({
          source: 'forms',
          id: s.id,
          formName: form.displayName || s.displayName || 'Webflow Form',
          timestamp: ts,
          name: fuzzy(r, [/full ?name/i, /^name$/i]),
          email: fuzzy(r, [/e-?mail/i]),
          phone: fuzzy(r, [/phone/i]),
          insurance: fuzzy(r, [/insurance/i]),
          zip: fuzzy(r, [/zip/i, /postal/i]),
          utm_source: exact(r, 'utm_source'),
          utm_medium: exact(r, 'utm_medium'),
          utm_campaign: exact(r, 'utm_campaign'),
          utm_term: exact(r, 'utm_term'),
          utm_content: exact(r, 'utm_content'),
          gclid: exact(r, 'gclid'),
          fbclid: exact(r, 'fbclid'),
          msclkid: exact(r, 'msclkid'),
          landing_page: exact(r, 'landing_page'),
          referrer: exact(r, 'referrer'),
          first_touch_source: exact(r, 'first_touch_source'),
          first_touch_landing: exact(r, 'first_touch_landing'),
          first_touch_date: exact(r, 'first_touch_date'),
          page_url: exact(r, 'page_url'),
          user_agent_summary: exact(r, 'user_agent_summary'),
        });
      }
      const total = data.pagination?.total ?? subs.length;
      offset += limit;
      if (subs.length === 0 || offset >= total) break;
    }
  }
  return out;
}

// Debug probe: returns the STRUCTURE of the first submission (top-level keys
// + metadata values, and formResponse field *names* only) so we can confirm
// the real field names without exposing any lead PII.
export async function sampleRaw() {
  const token = process.env.WEBFLOW_API_TOKEN;
  if (!token) return { error: 'WEBFLOW_API_TOKEN missing' };
  const siteId = await resolveSiteId(token);
  if (!siteId) return { error: 'no site' };
  const { forms } = await wf(`/sites/${siteId}/forms`, token);
  const form = (forms || [])[0];
  if (!form) return { siteId, forms: 0 };
  const data = await wf(`/forms/${form.id}/submissions?limit=1&offset=0`, token);
  const first = (data.formSubmissions || data.submissions || [])[0] || null;
  const meta = {};
  if (first) {
    for (const [k, v] of Object.entries(first)) {
      meta[k] = v && typeof v === 'object' ? '[object]' : String(v).slice(0, 32);
    }
  }
  const r = first && (first.formResponse || first.data || first.payload);
  return {
    siteId,
    formCount: forms.length,
    firstFormName: form.displayName,
    responseWrapperKey: first
      ? first.formResponse
        ? 'formResponse'
        : first.data
          ? 'data'
          : 'unknown'
      : null,
    submissionKeys: first ? Object.keys(first) : [],
    submissionMeta: meta,
    formResponseFieldNames: r ? Object.keys(r) : [],
    pagination: data.pagination || null,
  };
}

if (isMain(import.meta.url)) {
  pull()
    .then((records) => writeJSON('forms.json', records).then(() => records))
    .then((records) => console.log(`[etl:webflow] wrote ${records.length} form submissions`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
