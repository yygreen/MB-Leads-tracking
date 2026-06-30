// Shared date-range model for the dashboard's "Reporting Period" control.
// Presets are anchored to the data's own latest day (not wall-clock "today")
// so "This month" / "Last month" line up with whatever the data actually
// covers. All dates are ISO YYYY-MM-DD, which sorts and compares lexically.

export interface DateRange {
  from: string;
  to: string;
}

export type PresetKey =
  | 'thisMonth'
  | 'lastMonth'
  | 'last30'
  | 'last90'
  | 'last180'
  | 'custom';

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'last180', label: 'Last 180 days' },
  { key: 'custom', label: 'Custom' },
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

const atLeast = (v: string, min: string) => (v < min ? min : v);
const atMost = (v: string, max: string) => (v > max ? max : v);

/** Resolve a preset to a concrete {from,to}, clamped to the data's extent. */
export function presetRange(key: PresetKey, minDate: string, maxDate: string): DateRange {
  const end = new Date(maxDate + 'T00:00:00Z');
  const y = end.getUTCFullYear();
  const m = end.getUTCMonth(); // 0-based

  switch (key) {
    case 'thisMonth': {
      const from = `${maxDate.slice(0, 7)}-01`;
      return { from: atLeast(from, minDate), to: maxDate };
    }
    case 'lastMonth': {
      const firstPrev = iso(new Date(Date.UTC(y, m - 1, 1)));
      const lastPrev = iso(new Date(Date.UTC(y, m, 0))); // day 0 = last day of prev month
      return { from: atLeast(firstPrev, minDate), to: atMost(lastPrev, maxDate) };
    }
    case 'last90':
      return { from: atLeast(addDays(maxDate, -89), minDate), to: maxDate };
    case 'last180':
      return { from: minDate, to: maxDate };
    case 'last30':
    default:
      return { from: atLeast(addDays(maxDate, -29), minDate), to: maxDate };
  }
}

export function inRange(date: string, r: DateRange): boolean {
  return date >= r.from && date <= r.to;
}

function fmt(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Human label for a resolved range, e.g. "May 1 – May 31, 2026". */
export function rangeLabel(r: DateRange): string {
  return `${fmt(r.from)} – ${fmt(r.to)}`;
}

/** Inclusive day count of a range. */
export function rangeDays(r: DateRange): number {
  return Math.round(
    (new Date(r.to + 'T00:00:00Z').getTime() - new Date(r.from + 'T00:00:00Z').getTime()) / 86400000
  ) + 1;
}
