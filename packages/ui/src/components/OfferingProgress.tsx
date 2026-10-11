"use client";
import { useUiStrings } from "../i18n";

/** Units sold out of the 100-unit cap, with the minimum-to-settle marker (D-4). */
export function OfferingProgress({ sold, min, max = 100 }: { sold: number; min: number; max?: number }) {
  const t = useUiStrings().progress;
  const pct = Math.min(100, (sold / max) * 100);
  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-label={t.label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={sold}
        aria-valuetext={t.valueText(sold, max, min)}
      >
        <i style={{ width: `${pct}%` }} />
        <span className="min" style={{ left: `${(min / max) * 100}%` }} aria-hidden="true" />
      </div>
      <div className="prog-l">
        <span>{t.sold(sold, max)}</span>
        <span>{t.min(min)}</span>
      </div>
    </div>
  );
}
