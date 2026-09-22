// Grouping for the source / medium breakdown.
//
// The raw breakdown ran to fourteen rows, most of them ones and twos, and the
// same traffic read as several different things. This folds a (source, medium)
// pair into the channel a person would actually name, purely for display — the
// underlying tags are still stored and are shown beneath each row, so nothing
// is hidden or rewritten.

export type ChannelKey =
  | 'paid'
  | 'gbp'
  | 'organic'
  | 'ai'
  | 'referral'
  | 'direct'
  | 'other';

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  paid: 'Paid search & ads',
  gbp: 'Google Business Profile',
  organic: 'Organic search',
  ai: 'AI assistants',
  referral: 'Referrals',
  direct: 'Direct / untracked',
  other: 'Other',
};

// Display order — the channels a marketing conversation starts with first.
export const CHANNEL_ORDER: ChannelKey[] = [
  'organic',
  'gbp',
  'paid',
  'ai',
  'referral',
  'direct',
  'other',
];

const AI_SOURCES = new Set([
  'chatgpt.com',
  'chatgpt',
  'searchgpt',
  'gemini',
  'gemini.google.com',
  'copilot.com',
  'copilot',
  'perplexity.ai',
  'perplexity',
  'claude.ai',
]);

const PAID_MEDIA = new Set(['cpc', 'ppc', 'paid', 'display']);

/** Which channel a (source, medium) pair belongs to. */
export function channelOf(rawSource: string, rawMedium: string): ChannelKey {
  const s = String(rawSource || '').trim().toLowerCase();
  const m = String(rawMedium || '').trim().toLowerCase();

  if (!s || s === '(direct)') return 'direct';
  if (AI_SOURCES.has(s)) return 'ai';

  // Calls to the number on the Google Business Profile listing. CallRail tags
  // these `google / search` (96% of them arrive on the Google My Business
  // tracker, not the website swap pool), which is indistinguishable from paid
  // search at a glance despite being a different channel entirely.
  if (s === 'google my business' || s === 'google business profile') return 'gbp';
  if (s === 'google' && m === 'search') return 'gbp';

  if (PAID_MEDIA.has(m)) return 'paid';
  // AI engines are already matched above, so anything organic left here is a
  // conventional search engine (or a new one worth surfacing as organic rather
  // than silently reclassifying).
  if (m === 'organic') return 'organic';
  if (m === 'referral') return 'referral';
  return 'other';
}
