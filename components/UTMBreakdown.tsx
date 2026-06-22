import type { UTMRow } from '@/lib/types';

export default function UTMBreakdown({ rows }: { rows: UTMRow[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>UTM source</th>
            <th>Medium</th>
            <th className="num">Count</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.source}-${r.medium}`}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.source}</td>
              <td>
                <span className="tag-medium">{r.medium}</span>
              </td>
              <td className="num">{r.count.toLocaleString('en-US')}</td>
              <td className="num muted">{((r.count / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
