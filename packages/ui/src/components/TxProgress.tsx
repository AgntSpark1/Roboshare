import type { TxRun, TxStep } from "../tx";
import { shortAddr } from "../format";

const WORD = { idle: "等待", signing: "请在钱包中确认", pending: "等待区块确认", done: "已确认", error: "失败" } as const;

/** Step list for a multi-transaction flow; the live region announces each change to screen readers. */
export function TxProgress({ steps, run, explorer }: { steps: Pick<TxStep, "label">[]; run: TxRun; explorer?: string }) {
  return (
    <div className="txsteps" aria-live="polite">
      {steps.map((s, i) => {
        const st = run.states[i] ?? "idle";
        const h = run.hashes[i];
        return (
          <div key={s.label} className={`txs ${st === "signing" || st === "pending" ? "run" : st === "done" ? "done" : ""}`} data-state={st}>
            <span className="ic" aria-hidden="true">{st === "done" ? "✓" : i + 1}</span>
            <span>
              {s.label} · {WORD[st]}
              {h && (
                <>
                  {" "}
                  {explorer ? (
                    <a className="hash" href={`${explorer}/tx/${h}`} target="_blank" rel="noreferrer">{shortAddr(h, 10, 6)}</a>
                  ) : (
                    <span className="hash">{shortAddr(h, 10, 6)}</span>
                  )}
                </>
              )}
            </span>
          </div>
        );
      })}
      {run.error && <p className="err" role="alert">{run.error}</p>}
    </div>
  );
}
