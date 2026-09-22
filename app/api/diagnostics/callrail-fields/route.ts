import { NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { normalizeUTM } from '@/etl/aggregate.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// READ-ONLY probe: does CallRail already know the source of the calls our
// dashboard labels "(direct) / (none)"?
//
// Our ETL requests 13 fields, and of the attribution ones only source_name and
// utm_source/medium/campaign. For a session-level DNI pool ("Website pool"),
// source_name names the POOL, not the visitor's source — the per-session
// attribution CallRail captures via swap.js lives in other fields entirely
// (referring_url, landing_page_url, medium, campaign, keywords, gclid). A
// visitor who arrived from Google organic has a referrer but no utm_* at all,
// so utm_source comes back null whether or not CallRail knows where they came
// from. That is indistinguishable, from our side, from CallRail not knowing.
//
// This asks CallRail for the wider field set and reports, for exactly the calls
// the dashboard currently cannot attribute, how many carry each field. If they
// are populated, the bucket is recoverable by widening the ETL's field list —
// no change to the CallRail account.
//
//   ?days=30    window ending today (default 30)
//   ?top=15     cap on each value distribution
//
// Strictly read-only: a GET against CallRail's API, nothing written anywhere,
// no blob, no aggregate, the ETL and the dashboard untouched. Counts only —
// referrers reduce to host, URLs to path, and no call id, customer name or
// phone number is requested or returned.

type Row = Record<string, any>;

// Everything CallRail may expose that bears on attribution. Probed one by one
// when the account rejects the full set, so an unsupported field costs us the
// field, not the whole request.
const CANDIDATE_FIELDS = [
  'source_name',
  'source',
  'medium',
  'campaign',
  'keywords',
  'referring_url',
  'landing_page_url',
  'last_requested_url',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'gclid',
  'device_type',
  'tracker_id',
];
// Requested for windowing/filtering, not reported on.
const BASE_FIELDS = ['start_time', 'direction'];

const CR_BASE = 'https://api.callrail.com/v3/a';

function creds() {
  const apiKey = process.env.CALLRAIL_API_KEY;
  const accountId = process.env.CALLRAIL_ACCOUNT_ID;
  return { apiKey, accountId, ok: Boolean(apiKey && accountId) };
}

async function callrailGet(path: string, apiKey: string) {
  const res = await fetch(path, { headers: { Authorization: `Token token="${apiKey}"` } });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }
  // Never surface the response verbatim — it can echo the request URL, which
  // carries the key. A status plus the API's own message field is enough.
  return { ok: res.ok, status: res.status, body, message: body?.message || body?.error || null };
}

const hostOf = (raw: unknown) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const h = new URL(s.includes('://') ? s : `https://${s}`).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : '';
  } catch {
    return '';
  }
};

const pathOf = (raw: unknown) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return s.split(/[?#]/)[0].replace(/\/+$/, '') || '';
  }
};

const tally = (values: string[], top: number) => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  const sorted = Object.entries(out).sort((a, b) => b[1] - a[1]);
  const obj = Object.fromEntries(sorted.slice(0, top));
  const rest = sorted.slice(top).reduce((a, [, n]) => a + n, 0);
  if (rest) obj[`…${sorted.length - top} more`] = rest;
  return obj;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// A field "carries attribution" when it holds something other than a sentinel.
const NULL_SIGNALS = new Set(['', '(direct)', '(none)', 'direct', 'none', 'unknown', 'null', '-']);
const populated = (v: unknown) => !NULL_SIGNALS.has(String(v ?? '').trim().toLowerCase());

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { apiKey, accountId, ok } = creds();
  if (!ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'CallRail credentials not configured',
        // Names and set/not-set only — never a value.
        env: {
          CALLRAIL_API_KEY: Boolean(process.env.CALLRAIL_API_KEY),
          CALLRAIL_ACCOUNT_ID: Boolean(process.env.CALLRAIL_ACCOUNT_ID),
        },
      },
      { status: 400 }
    );
  }

  const params = new URL(req.url).searchParams;
  const days = Math.min(Math.max(Number(params.get('days')) || 30, 1), 365);
  const top = Math.min(Math.max(Number(params.get('top')) || 15, 1), 100);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const startDate = since.toISOString().slice(0, 10);

  // 1. Establish which candidate fields this account will actually return.
  const q = (fields: string[], perPage: number, page = 1) =>
    `${CR_BASE}/${accountId}/calls.json?` +
    new URLSearchParams({
      fields: fields.join(','),
      start_date: startDate,
      per_page: String(perPage),
      page: String(page),
    });

  let supported = [...CANDIDATE_FIELDS];
  const rejected: string[] = [];
  const probe = await callrailGet(q([...BASE_FIELDS, ...supported], 1), apiKey!);
  if (!probe.ok) {
    // Narrow one field at a time so a single unsupported name doesn't cost us
    // the whole probe.
    supported = [];
    for (const f of CANDIDATE_FIELDS) {
      const one = await callrailGet(q([...BASE_FIELDS, f], 1), apiKey!);
      (one.ok ? supported : rejected).push(f);
    }
    if (!supported.length) {
      return NextResponse.json(
        {
          ok: false,
          error: 'CallRail rejected every candidate field',
          status: probe.status,
          apiMessage: probe.message,
        },
        { status: 502 }
      );
    }
  }

  // 2. Pull the window with the supported set.
  const calls: Row[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await callrailGet(q([...BASE_FIELDS, ...supported], 250, page), apiKey!);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'CallRail pull failed', status: res.status, apiMessage: res.message, page },
        { status: 502 }
      );
    }
    calls.push(...(res.body?.calls || []));
    totalPages = Math.min(res.body?.total_pages || 1, 10);
    page += 1;
  } while (page <= totalPages);

  // 3. The calls the dashboard cannot attribute today: utm_* resolve to the
  //    sentinel pair, exactly as etl/aggregate.js classifies them.
  const untagged = calls.filter((c) => {
    const n = normalizeUTM(c.utm_source, c.utm_medium);
    return n.source === '(direct)' && n.medium === '(none)';
  });

  // Of those, the ones whose source_name is only a swap-pool label — the 32.
  const poolOnly = untagged.filter((c) => /\bpool\b/.test(String(c.source_name || '').toLowerCase()));

  // Per-click/per-visitor identifiers. Knowing HOW MANY calls carry one is the
  // finding; the values themselves are opaque handles that join back to an
  // individual click, so they are counted and never listed.
  const ID_FIELDS = new Set(['gclid', 'tracker_id']);

  const fieldReport = (rows: Row[]) => {
    const out: Record<string, any> = {};
    for (const f of supported) {
      if (f.startsWith('utm_')) continue; // known-null for this cohort
      const hits = rows.filter((r) => populated(r[f]));
      if (!hits.length) {
        out[f] = { populated: 0 };
        continue;
      }
      if (ID_FIELDS.has(f)) {
        out[f] = { populated: hits.length, share: pct(hits.length, rows.length), values: 'omitted (identifier)' };
        continue;
      }
      const values =
        f === 'referring_url'
          ? hits.map((r) => hostOf(r[f])).filter(Boolean)
          : f.endsWith('_url') || f === 'landing_page_url'
            ? hits.map((r) => pathOf(r[f])).filter(Boolean)
            : hits.map((r) => String(r[f]).toLowerCase());
      out[f] = {
        populated: hits.length,
        share: pct(hits.length, rows.length),
        values: tally(values, top),
      };
    }
    return out;
  };

  // The headline: how many of the unattributable calls carry ANY real source
  // signal in the fields we don't currently request.
  const RECOVERY_FIELDS = ['referring_url', 'landing_page_url', 'medium', 'campaign', 'keywords', 'gclid', 'source'];
  const hasAnySignal = (r: Row) =>
    RECOVERY_FIELDS.some((f) => supported.includes(f) && populated(r[f]));
  const untaggedRecoverable = untagged.filter(hasAnySignal).length;
  const poolRecoverable = poolOnly.filter(hasAnySignal).length;

  return NextResponse.json({
    ok: true,
    note:
      'Read-only probe of the CallRail API. Nothing written, ETL and dashboard unchanged. ' +
      'Counts only — referrers reduced to host, URLs to path; no call id, customer name or phone number requested.',
    window: { days, startDate },
    fields: {
      requestedByEtlToday: ['source_name', 'utm_source', 'utm_medium', 'utm_campaign'],
      supportedByAccount: supported,
      rejectedByAccount: rejected,
    },
    totals: {
      calls: calls.length,
      untagged: untagged.length,
      untaggedShare: pct(untagged.length, calls.length),
      untaggedWithSignalInUnrequestedFields: untaggedRecoverable,
      recoverableShare: pct(untaggedRecoverable, untagged.length),
    },
    poolLabelledCalls: {
      count: poolOnly.length,
      withSignalInUnrequestedFields: poolRecoverable,
      recoverableShare: pct(poolRecoverable, poolOnly.length),
      sourceNames: tally(
        poolOnly.map((c) => String(c.source_name || '').toLowerCase()),
        top
      ),
      fields: fieldReport(poolOnly),
    },
    allUntagged: {
      count: untagged.length,
      sourceNames: tally(
        untagged.map((c) => String(c.source_name || '(empty)').toLowerCase()),
        top
      ),
      fields: fieldReport(untagged),
    },
  });
}
