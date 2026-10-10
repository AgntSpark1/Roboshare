/** Units sold out of the 100-unit cap, with the minimum-to-settle marker (D-4). */
export function OfferingProgress({ sold, min, max = 100 }: { sold: number; min: number; max?: number }) {
  const pct = Math.min(100, (sold / max) * 100);
  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-label="募集进度"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={sold}
        aria-valuetext={`已认购 ${sold} / ${max} 份，最低 ${min} 份`}
      >
        <i style={{ width: `${pct}%` }} />
        <span className="min" style={{ left: `${(min / max) * 100}%` }} aria-hidden="true" />
      </div>
      <div className="prog-l">
        <span>已认购 {sold} / {max} 份</span>
        <span>最低 {min} 份</span>
      </div>
    </div>
  );
}
