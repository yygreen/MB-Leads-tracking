'use client';

// Custom chart legend whose swatches match the rendered areas. The stacked
// Area fills use a translucent gradient, so a solid legend dot (recharts'
// default, taken from the stroke) looks darker/more saturated than the band —
// most visibly for the navy series, which renders as grey in the chart. Here we
// draw each area swatch at the same opacity as its fill, so the legend matches
// what's on the chart. The Total line keeps a solid line swatch.

const FILL_OPACITY = 0.72; // ~midpoint of the area gradient (0.9 → 0.55)

export default function ChartLegend({
  payload,
  totalKey = 'total',
}: {
  payload?: Array<{ value: string; color?: string; dataKey?: string | number }>;
  totalKey?: string;
}) {
  if (!payload) return null;
  return (
    <ul
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '8px 16px',
        listStyle: 'none',
        margin: 0,
        padding: '8px 0 0',
        fontSize: 12.5,
      }}
    >
      {payload.map((entry) => {
        const isTotal = entry.dataKey === totalKey;
        return (
          <li
            key={String(entry.dataKey ?? entry.value)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#5a5a5a' }}
          >
            {isTotal ? (
              <span
                style={{
                  width: 16,
                  height: 3,
                  borderRadius: 2,
                  background: entry.color,
                  display: 'inline-block',
                }}
              />
            ) : (
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: entry.color,
                  opacity: FILL_OPACITY,
                  display: 'inline-block',
                }}
              />
            )}
            <span>{entry.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
