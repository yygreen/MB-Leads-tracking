import type { ChannelMixRow } from '@/lib/types';

export default function ChannelMixTable({ rows }: { rows: ChannelMixRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="num">30-day count</th>
            <th style={{ width: '38%' }}>Share</th>
            <th className="num">% of total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.channel}</td>
              <td className="num">{r.count.toLocaleString('en-US')}</td>
              <td className="bar-cell">
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(r.count / max) * 100}%` }} />
                </div>
              </td>
              <td className="num">{r.pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
