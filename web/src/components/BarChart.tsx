/**
 * A bar chart, hand-rolled in SVG.
 *
 * No charting library, and that is a deliberate call rather than stubbornness. Recharts or
 * Chart.js would add 100–500 kB to a dashboard whose entire dataset today is 770 rows, and
 * every one of them arrives with its own visual language that would then have to be fought
 * back into Anton/Courier and the purple ramp. Bars, a baseline and a hover label is the
 * whole requirement.
 *
 * Revisit when a chart needs something structural — zoom, brushing, multiple series with
 * independent axes. Not before.
 */
export type Bar = { label: string; value: number; hint?: string };

export function BarChart({
  bars,
  height = 160,
  emptyLabel = 'No plays in this window',
}: {
  bars: Bar[];
  height?: number;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...bars.map(b => b.value));
  const total = bars.reduce((s, b) => s + b.value, 0);

  if (bars.length === 0 || total === 0) {
    return (
      <div className="chart chart--empty" style={{ height }}>
        <span className="hint">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="chart" style={{ height }}>
      <div className="chart__bars">
        {bars.map((b, i) => {
          // A bar with a real value never renders as nothing: 2px minimum, so "one play"
          // is visible rather than indistinguishable from "no plays".
          const pct = b.value === 0 ? 0 : Math.max(2, (b.value / max) * 100);
          return (
            <div
              className="chart__slot"
              key={`${b.label}-${i}`}
              title={b.hint ?? `${b.label}: ${b.value}`}
            >
              <div
                className="chart__bar"
                data-zero={b.value === 0 || undefined}
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="chart__axis">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </div>
  );
}
