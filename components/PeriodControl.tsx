'use client';

import type { DateRange, PresetKey } from '@/lib/dateRange';
import { PRESETS, rangeLabel } from '@/lib/dateRange';
import DateField from './DateField';

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
          <DateField
            ariaLabel="From date"
            value={range.from}
            min={minDate}
            max={range.to}
            onChange={(d) => onCustom({ from: d, to: range.to })}
          />
          <span className="period-dash">→</span>
          <DateField
            ariaLabel="To date"
            value={range.to}
            min={range.from}
            max={maxDate}
            onChange={(d) => onCustom({ from: range.from, to: d })}
          />
        </div>
      </div>
    </div>
  );
}
