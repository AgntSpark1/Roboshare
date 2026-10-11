"use client";
import { useCallback, useState } from "react";
import { sendTransaction, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { useWalletConfig } from "./wallet";
import { useUiStrings, zhUiStrings, type UiStrings } from "./i18n";
import { BaseError, type Abi, type Hash } from "viem";
import type { PreparedTx } from "./api";

/** One wallet transaction: either a call the API prepared, or a contract write built in the browser. */
export type TxStep =
  | { label: string; prepared: PreparedTx }
  | { label: string; write: { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[] } };

export type StepState = "idle" | "signing" | "pending" | "done" | "error";

export interface TxRun {
  states: StepState[];
  hashes: (Hash | undefined)[];
  error: string | null;
  running: boolean;
}

/** Human-readable reason for a wallet or contract error. */
export function txErrorMessage(e: unknown, t: UiStrings = zhUiStrings): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => (x as { name?: string }).name === "UserRejectedRequestError")) return t.txRejected;
    const revert = e.walk((x) => (x as { name?: string }).name === "ContractFunctionRevertedError") as
      | { data?: { errorName?: string }; reason?: string }
      | null;
    if (revert?.data?.errorName) return t.contractRejected(revert.data.errorName);
    if (revert?.reason) return t.contractRejected(revert.reason);
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * Runs wallet steps in order and waits for each receipt before the next one, so an approval is mined before the
 * call that depends on it. `onSubmitted` lets the caller register the hash (e.g. POST /tx/pending).
 */
export function useTxRunner() {
  const config = useWalletConfig();
  const t = useUiStrings();
  const [run, setRun] = useState<TxRun>({ states: [], hashes: [], error: null, running: false });

  const start = useCallback(
    async (steps: TxStep[], onSubmitted?: (hash: Hash, index: number) => void): Promise<boolean> => {
      const states: StepState[] = steps.map(() => "idle");
      const hashes: (Hash | undefined)[] = steps.map(() => undefined);
      const push = (error: string | null, running: boolean) => setRun({ states: [...states], hashes: [...hashes], error, running });
      push(null, true);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        try {
          states[i] = "signing";
          push(null, true);
          const hash =
            "prepared" in s
              ? await sendTransaction(config, { to: s.prepared.to, data: s.prepared.data, value: 0n, chainId: s.prepared.chainId })
              : await writeContract(config, s.write as Parameters<typeof writeContract>[1]);
          hashes[i] = hash;
          states[i] = "pending";
          push(null, true);
          onSubmitted?.(hash, i);
          const receipt = await waitForTransactionReceipt(config, { hash });
          if (receipt.status !== "success") throw new Error(t.txReverted);
          states[i] = "done";
          push(null, true);
        } catch (e) {
          states[i] = "error";
          push(txErrorMessage(e, t), false);
          return false;
        }
      }
      push(null, false);
      return true;
    },
    [config],
  );

  const reset = useCallback(() => setRun({ states: [], hashes: [], error: null, running: false }), []);
  return { run, start, reset };
}
