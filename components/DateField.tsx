'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// A self-contained date picker that always renders in English, regardless of
// the viewer's browser/OS locale. (Native <input type="date"> follows the OS
// locale, which showed German for some users — this avoids that entirely.)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseISO(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m: m - 1, d };
}
function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function label(s: string) {
  if (!s) return '—';
  const { y, m, d } = parseISO(s);
  return `${MONTHS[m].slice(0, 3)} ${d}, ${y}`;
}

export default function DateField({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: string;
  min?: string;
  max?: string;
  onChange: (iso: string) => void;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const { y, m } = parseISO(value);
    return { y, m };
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const { y, m } = parseISO(value);
      setView({ y, m });
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cells = useMemo(() => {
    const startDow = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
    const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
    const out: Array<number | null> = [];
    for (let i = 0; i < startDow; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(d);
    return out;
  }, [view]);

  const inRange = (ds: string) => (!min || ds >= min) && (!max || ds <= max);
  const prevLast = new Date(Date.UTC(view.y, view.m, 0)).toISOString().slice(0, 10);
  const nextFirst = new Date(Date.UTC(view.y, view.m + 1, 1)).toISOString().slice(0, 10);
  const canPrev = !min || prevLast >= min;
  const canNext = !max || nextFirst <= max;

  const prev = () => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }));
  const next = () => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }));

  return (
    <div className="datefield" ref={ref}>
      <button
        type="button"
        className="datefield-btn"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {label(value)}
      </button>
      {open && (
        <div className="datefield-pop" role="dialog">
          <div className="df-head">
            <button type="button" onClick={prev} disabled={!canPrev} aria-label="Previous month">
              ‹
            </button>
            <span className="df-title">
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" onClick={next} disabled={!canNext} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="df-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="df-grid">
            {cells.map((d, i) => {
              if (d === null) return <span key={`e${i}`} className="df-empty" />;
              const ds = iso(view.y, view.m, d);
              const ok = inRange(ds);
              const sel = ds === value;
              return (
                <button
                  key={ds}
                  type="button"
                  disabled={!ok}
                  className={`df-day${sel ? ' sel' : ''}`}
                  onClick={() => {
                    onChange(ds);
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
