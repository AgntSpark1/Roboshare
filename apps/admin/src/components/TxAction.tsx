"use client";
import { useState, type ReactNode } from "react";
import { TxProgress, useTxRunner, type PreparedTx, type TxStep } from "@roboshare/ui";
import { explorer } from "@/env";
import { errorText } from "@/lib/admin";

/**
 * A staff action: asks the API to validate and prepare the transaction(s), then the connected staff wallet signs them.
 * The server never signs. `prepare` may also return steps built in the browser (e.g. reading the chain first).
 */
export function TxAction({
  label,
  prepare,
  onDone,
  className = "btn primary sm",
  disabled,
  confirm,
}: {
  label: ReactNode;
  prepare: () => Promise<TxStep[] | PreparedTx | PreparedTx[]>;
  onDone?: () => void;
  className?: string;
  disabled?: boolean;
  confirm?: string;
}) {
  const { run, start, reset } = useTxRunner();
  const [steps, setSteps] = useState<TxStep[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (confirm && !window.confirm(confirm)) return;
    reset();
    setErr(null);
    setBusy(true);
    try {
      const r = await prepare();
      const list = Array.isArray(r) ? r : [r];
      const s: TxStep[] = list.map((x) => ("label" in x ? x : { label: x.description, prepared: x }));
      setSteps(s);
      if (await start(s)) onDone?.();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div>
        <button type="button" className={className} disabled={disabled || busy || run.running} onClick={go}>
          {busy ? <span className="spin" aria-hidden="true" /> : null}
          {label}
        </button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {steps.length > 0 && <TxProgress steps={steps} run={run} explorer={explorer} />}
    </div>
  );
}
