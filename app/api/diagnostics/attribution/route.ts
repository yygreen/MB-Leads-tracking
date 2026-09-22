import { NextResponse } from 'next/server';
import { authorizeAdmin, unauthorized } from '@/lib/cron';
import { readJSON, readCollection } from '@/etl/_lib.js';
import { normalizeUTM } from '@/etl/aggregate.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// READ-ONLY diagnostic: how much of the "(direct) / (none)" bucket is actually
// recoverable from attribution we already store but the dashboard ignores.
//
// The dashboard labels a lead (direct)/(none) whenever normalizeUTM(utm_source,
// utm_medium) resolves to the sentinel pair. But several channels persist other
// attribution alongside the (empty) utm_* fields:
//
//   CallRail  tracking_source            — CallRail's own source_name
//   Forms     first_touch_source, referrer, landing_page, page_url, gclid/…
//   Leadtrap  lead_source                — Leadtrap's own Source label
//   Email     (nothing — by design, only {source, timestamp} is stored)
//
// This endpoint measures, per channel, how many untagged leads carry a usable
// signal, what those signals say, and what a candidate fallback chain WOULD
// resolve them to. It changes nothing: no writes, no aggregate, no blob.
//
//   ?days=30   window ending today (default 30; also try 90, 180)
//   ?top=15    cap on each value distribution
//
// Counts only. No name, email, phone, or full URL with query string is ever
// returned — referrers reduce to host, page URLs to path.

type Row = Record<string, any>;

// Timestamps arrive ISO (webhooks, CallRail) or RFC-2822 (forwarded email), so
// parse properly rather than slicing the string.
function dayOf(raw: unknown): string | null {
  const s = String(raw || '');
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

const SELF_DOMAINS = ['mastermindbehavior.com'];
const isSelf = (host: string) =>
  SELF_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));

// Sentinels the tracking script writes into referrer/first_touch_source when it
// has nothing: these are the absence of a signal, not a value. Without this the
// literal string "(direct)" parses as a hostname and invents a referral.
const NULL_SIGNALS = new Set(['(direct)', '(none)', 'direct', 'none', 'unknown', 'null', '-']);
const isNullSignal = (raw: unknown) =>
  NULL_SIGNALS.has(String(raw || '').trim().toLowerCase());

// Reduce a referrer to its bare host: enough to identify the traffic source,
// nothing that could carry a query string or a path with identifiers. Returns
// '' for sentinels and for anything that isn't a plausible hostname.
function hostOf(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s || isNullSignal(s)) return '';
  try {
    const host = new URL(s.includes('://') ? s : `https://${s}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    // A real host has a dot and no URL-illegal leftovers; this rejects the
    // sentinel strings that otherwise sail through URL parsing.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

// Reduce a URL to its path, dropping query + hash (which is where any PII or
// tracking payload would live). "/" stays "/".
function pathOf(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    const cut = s.split(/[?#]/)[0];
    return cut.replace(/\/+$/, '') || (cut ? cut : '');
  }
}

// Pull utm_* / click ids out of a stored URL's query string. Landing pages are
// captured verbatim by the tracking script, so a campaign-tagged visit that
// lost its utm_* fields on the way into the record often still has them here.
function utmFromUrl(raw: unknown): { source?: string; medium?: string; clickId?: string } {
  const s = String(raw || '').trim();
  if (!s || !s.includes('?')) return {};
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    const q = u.searchParams;
    const source = q.get('utm_source') || undefined;
    const medium = q.get('utm_medium') || undefined;
    const clickId = q.get('gclid') ? 'gclid' : q.get('fbclid') ? 'fbclid' : q.get('msclkid') ? 'msclkid' : undefined;
    return { source, medium, clickId };
  } catch {
    return {};
  }
}

// Search engines arrive as a referrer host; treat them as organic search rather
// than as a referral from "google.com".
const SEARCH_HOSTS: Record<string, string> = {
  google: 'google',
  bing: 'bing',
  duckduckgo: 'duckduckgo',
  yahoo: 'yahoo',
  ecosia: 'ecosia',
  brave: 'brave',
};
function searchEngine(host: string): string | null {
  for (const [key, name] of Object.entries(SEARCH_HOSTS)) {
    if (host === key || host.startsWith(`${key}.`) || host.includes(`.${key}.`)) return name;
  }
  return null;
}

// A hostname → the source/medium it implies. Our own domain resolves to
// nothing: a visitor arriving from one of our own pages is a session artifact,
// not an acquisition source.
function fromHost(host: string): { source: string; medium: string } | null {
  if (!host || isSelf(host)) return null;
  const engine = searchEngine(host);
  return engine
    ? { source: engine, medium: 'organic' }
    : { source: host, medium: 'referral' };
}

// CallRail swap-pool labels ("Website pool", "Offline pool"). A pool is a set
// of DNI numbers, not an acquisition source.
const isPoolLabel = (label: string) => /\bpool\b/.test(label);

const tally = (values: string[], top: number) => {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] || 0) + 1;
  const sorted = Object.entries(out).sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, top);
  const restCount = sorted.slice(top).reduce((a, [, n]) => a + n, 0);
  const obj = Object.fromEntries(head);
  if (restCount) obj[`…${sorted.length - top} more`] = restCount;
  return obj;
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// The candidate fallback chain, applied in priority order. Returns the rung
// that fired plus what the lead would be relabelled as. Nothing here is wired
// into the dashboard — this is the projection that says what wiring it would buy.
function recover(channel: string, r: Row): { by: string; source: string; medium: string } | null {
  // 1. An explicit click id is unambiguous paid traffic.
  const click = r.gclid ? 'gclid' : r.fbclid ? 'fbclid' : r.msclkid ? 'msclkid' : null;
  if (click) {
    const map: Record<string, [string, string]> = {
      gclid: ['google', 'cpc'],
      fbclid: ['facebook', 'paid'],
      msclkid: ['bing', 'cpc'],
    };
    const [source, medium] = map[click];
    return { by: 'clickId', source, medium };
  }

  // 2. utm_* still sitting in the captured landing page / page URL query string.
  for (const field of ['landing_page', 'first_touch_landing', 'page_url']) {
    const found = utmFromUrl(r[field]);
    if (found.clickId && !found.source) {
      const map: Record<string, [string, string]> = {
        gclid: ['google', 'cpc'],
        fbclid: ['facebook', 'paid'],
        msclkid: ['bing', 'cpc'],
      };
      const [source, medium] = map[found.clickId];
      return { by: 'landingPageQuery', source, medium };
    }
    if (found.source) {
      const n = normalizeUTM(found.source, found.medium);
      if (n.source !== '(direct)') return { by: 'landingPageQuery', ...n };
    }
  }

  // 3. The channel's own source label. CallRail writes source_name
  //    ("Google My Business", "Website pool"); Leadtrap writes Source.
  const own = channel === 'callrail' ? r.tracking_source : channel === 'leadtrap' ? r.lead_source : null;
  if (own && !isNullSignal(own)) {
    const label = String(own).trim().toLowerCase();
    // CallRail swap POOLS are not traffic sources. "Website pool" means the
    // number was swapped in by DNI for a site visitor — it says the call came
    // from the website, which we already knew, and nothing about how that
    // visitor got there. Counting it as recovered would be self-deception.
    if (!isPoolLabel(label)) {
      // "Direct Traffic" is CallRail's way of saying it doesn't know either.
      const n = normalizeUTM(label.replace(/\s+traffic$/, ''), null);
      if (n.source !== '(direct)') return { by: 'ownSourceLabel', ...n };
    }
  }

  // 4. First-touch source recorded by the tracking script at session start.
  //    The script stores a full referrer URL here, not a source token, so
  //    resolve it as a host before falling back to treating it as a token.
  if (r.first_touch_source && !isNullSignal(r.first_touch_source)) {
    const hit = fromHost(hostOf(r.first_touch_source));
    if (hit) return { by: 'firstTouchSource', ...hit };
    if (!String(r.first_touch_source).includes('://')) {
      const n = normalizeUTM(r.first_touch_source, null);
      if (n.source !== '(direct)') return { by: 'firstTouchSource', ...n };
    }
  }

  // 5. The referrer host: a search engine means organic, anything else referral.
  const hit = fromHost(hostOf(r.referrer));
  if (hit) return { by: 'referrer', ...hit };

  return null;
}

export async function GET(req: Request) {
  // Admin-gated: this reads stored lead records back out. Counts only, but the
  // campaign, keyword and landing-page distributions are the client's data.
  if (!authorizeAdmin(req)) return unauthorized(req);
  const params = new URL(req.url).searchParams;
  const days = Math.min(Math.max(Number(params.get('days')) || 30, 1), 365);
  const top = Math.min(Math.max(Number(params.get('top')) || 15, 1), 100);

  const [callrail, forms, leadtrap, email] = await Promise.all([
    readJSON('callrail.json', []) as Promise<Row[]>,
    readJSON('forms.json', []) as Promise<Row[]>,
    readCollection('leadtrap') as Promise<Row[]>,
    readCollection('email') as Promise<Row[]>,
  ]);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today);
  from.setUTCDate(today.getUTCDate() - (days - 1));
  const fromKey = from.toISOString().slice(0, 10);
  const toKey = today.toISOString().slice(0, 10);

  const channels: Array<[string, Row[]]> = [
    ['callrail', callrail],
    ['forms', forms],
    ['leadtrap', leadtrap],
    ['email', email],
  ];

  const perChannel: Record<string, any> = {};
  const resolvedBy: Record<string, number> = {};
  const projectedCombo: string[] = [];
  let totalLeads = 0;
  let totalUntagged = 0;
  let totalRecovered = 0;

  for (const [channel, rows] of channels) {
    const inWindow = rows.filter((r) => {
      const d = dayOf(r.timestamp || r.submittedAt);
      return d !== null && d >= fromKey && d <= toKey;
    });
    // Classify exactly as the dashboard does, so the untagged count here is the
    // same number the "(direct) / (none)" row shows.
    const untagged = inWindow.filter((r) => {
      const n = normalizeUTM(r.utm_source, r.utm_medium);
      return n.source === '(direct)' && n.medium === '(none)';
    });

    const signals = {
      tracking_source: untagged.filter((r) => r.tracking_source && !isNullSignal(r.tracking_source)).length,
      lead_source: untagged.filter((r) => r.lead_source && !isNullSignal(r.lead_source)).length,
      first_touch_source: untagged.filter(
        (r) => r.first_touch_source && !isNullSignal(r.first_touch_source)
      ).length,
      referrer: untagged.filter((r) => fromHost(hostOf(r.referrer))).length,
      landing_page: untagged.filter((r) => r.landing_page).length,
      page_url: untagged.filter((r) => r.page_url).length,
      clickId: untagged.filter((r) => r.gclid || r.fbclid || r.msclkid).length,
      // Present-but-worthless: a swap-pool label says "came via the website"
      // and nothing about acquisition. Counted here so it is visible rather
      // than quietly folded into either recovered or unrecoverable.
      poolLabelOnly: untagged.filter(
        (r) => r.tracking_source && isPoolLabel(String(r.tracking_source).toLowerCase())
      ).length,
    };
    // Only report signals this channel actually stores — a zero for a field the
    // channel never writes is noise, not a finding.
    const present = Object.fromEntries(
      Object.entries(signals).filter(([, n]) => n > 0)
    );

    let recovered = 0;
    const byRung: Record<string, number> = {};
    for (const r of untagged) {
      const hit = recover(channel, r);
      if (!hit) {
        byRung.unrecoverable = (byRung.unrecoverable || 0) + 1;
        resolvedBy.unrecoverable = (resolvedBy.unrecoverable || 0) + 1;
        continue;
      }
      recovered += 1;
      byRung[hit.by] = (byRung[hit.by] || 0) + 1;
      resolvedBy[hit.by] = (resolvedBy[hit.by] || 0) + 1;
      projectedCombo.push(`${hit.source} / ${hit.medium}`);
    }

    totalLeads += inWindow.length;
    totalUntagged += untagged.length;
    totalRecovered += recovered;

    perChannel[channel] = {
      leads: inWindow.length,
      untagged: untagged.length,
      untaggedShare: pct(untagged.length, inWindow.length),
      recoverable: recovered,
      recoverableShare: pct(recovered, untagged.length),
      signalsPresent: present,
      resolvedBy: Object.fromEntries(
        Object.entries(byRung).sort((a, b) => b[1] - a[1])
      ),
      values: {
        tracking_source: tally(
          untagged.map((r) => String(r.tracking_source || '')).filter(Boolean),
          top
        ),
        lead_source: tally(
          untagged.map((r) => String(r.lead_source || '')).filter(Boolean),
          top
        ),
        first_touch_source: tally(
          untagged.map((r) => String(r.first_touch_source || '').toLowerCase()).filter(Boolean),
          top
        ),
        referrer_host: tally(
          untagged.map((r) => hostOf(r.referrer)).filter((h) => h && !isSelf(h)),
          top
        ),
        landing_path: tally(
          untagged.map((r) => pathOf(r.landing_page || r.page_url)).filter(Boolean),
          top
        ),
      },
    };
    // Drop the empty distributions so the payload stays readable.
    for (const k of Object.keys(perChannel[channel].values)) {
      if (!Object.keys(perChannel[channel].values[k]).length) {
        delete perChannel[channel].values[k];
      }
    }
  }

  return NextResponse.json({
    ok: true,
    note:
      'Read-only measurement. Nothing is written and the dashboard is unchanged — ' +
      '"projected" shows what a fallback chain WOULD recover if wired in. ' +
      'Counts only: referrers are reduced to host, URLs to path, query strings dropped.',
    window: { days, from: fromKey, to: toKey },
    totals: {
      leads: totalLeads,
      untagged: totalUntagged,
      untaggedShare: pct(totalUntagged, totalLeads),
      recoverable: totalRecovered,
      recoverableShare: pct(totalRecovered, totalUntagged),
      residualUntagged: totalUntagged - totalRecovered,
      residualShareOfAllLeads: pct(totalUntagged - totalRecovered, totalLeads),
    },
    resolvedBy: Object.fromEntries(Object.entries(resolvedBy).sort((a, b) => b[1] - a[1])),
    projected: tally(projectedCombo, top),
    byChannel: perChannel,
  });
}
