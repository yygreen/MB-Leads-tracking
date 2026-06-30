'use client';

import type { DateRange, PresetKey } from '@/lib/dateRange';
import { PRESETS, rangeLabel } from '@/lib/dateRange';

export default function PeriodControl({
  presetKey,
  range,
  minDate,
  maxDate,
  onPreset,
  onCustom,
}: {
  presetKey: PresetKey;
  range: DateRange;
  minDate: string;
  maxDate: string;
  onPreset: (key: PresetKey) => void;
  onCustom: (range: DateRange) => void;
}) {
  return (
    <div className="period-bar">
      <div className="period-head">
        <span className="period-title">Reporting period</span>
        <span className="period-resolved">{rangeLabel(range)}</span>
      </div>
      <div className="period-controls">
        <div className="toggle period-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={p.key === presetKey ? 'active' : ''}
              onClick={() => onPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="period-custom">
          <input
            type="date"
            aria-label="From date"
            value={range.from}
            min={minDate}
            max={range.to}
            onChange={(e) => onCustom({ from: e.target.value || minDate, to: range.to })}
          />
          <span className="period-dash">→</span>
          <input
            type="date"
            aria-label="To date"
            value={range.to}
            min={range.from}
            max={maxDate}
            onChange={(e) => onCustom({ from: range.from, to: e.target.value || maxDate })}
          />
        </div>
      </div>
    </div>
  );
}
