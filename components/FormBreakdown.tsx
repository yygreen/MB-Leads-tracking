import type { FormRow } from '@/lib/types';

export default function FormBreakdown({ rows }: { rows: FormRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>Form</th>
            <th className="num">Submissions (30d)</th>
            <th style={{ width: '34%' }}>Share</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.name}</td>
              <td className="num">{r.count.toLocaleString('en-US')}</td>
              <td className="bar-cell">
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(r.count / max) * 100}%`, background: 'var(--accent)' }}
                  />
                </div>
              </td>
              <td className="num muted">{((r.count / total) * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
