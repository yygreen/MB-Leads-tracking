import type { GBPLocationRow } from '@/lib/types';

function cell(v: number | null): string {
  return v === null ? '—' : v.toLocaleString('en-US');
}

export default function GBPLocations({ rows }: { rows: GBPLocationRow[] }) {
  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>Location</th>
            <th className="num">Leads</th>
            <th className="num">Calls</th>
            <th className="num">Website clicks</th>
            <th className="num">Directions</th>
            <th className="num">Impressions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>
                <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{r.name}</div>
                {r.status === 'pending' && r.note && (
                  <div className="note-pending">{r.note}</div>
                )}
              </td>
              {r.status === 'pending' ? (
                <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                  No access yet
                </td>
              ) : (
                <>
                  <td className="num" style={{ fontWeight: 600, color: 'var(--navy)' }}>
                    {cell(r.leads ?? null)}
                  </td>
                  <td className="num">{cell(r.calls)}</td>
                  <td className="num">{cell(r.websiteClicks)}</td>
                  <td className="num">{cell(r.directions)}</td>
                  <td className="num">{cell(r.impressions)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Leads = calls + website clicks. Directions &amp; impressions are visibility, not leads.
      </div>
    </div>
  );
}
