import type { GBPStateRow } from '@/lib/types';

const STATE_NAMES: Record<string, string> = {
  NJ: 'New Jersey',
  GA: 'Georgia',
};

function n(v: number): string {
  return v.toLocaleString('en-US');
}

// GBP rolled up per state: NJ = Lakewood + Hackensack, GA = Macon + Warner Robins.
// Components only — no summed "leads"; calls (tap-to-call) is the intent signal.
export default function GBPStates({ rows }: { rows: GBPStateRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="card card-pad">
      <table className="table">
        <thead>
          <tr>
            <th>State</th>
            <th className="num">Profiles</th>
            <th className="num">Calls</th>
            <th className="num">Website clicks</th>
            <th className="num">Directions</th>
            <th className="num">Impressions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.state}>
              <td style={{ fontWeight: 600, color: 'var(--navy)' }}>
                {STATE_NAMES[r.state] || r.state}
              </td>
              <td className="num">{n(r.locations)}</td>
              <td className="num" style={{ fontWeight: 600, color: 'var(--navy)' }}>
                {n(r.calls)}
              </td>
              <td className="num">{n(r.websiteClicks)}</td>
              <td className="num">{n(r.directions)}</td>
              <td className="num">{n(r.impressions)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
