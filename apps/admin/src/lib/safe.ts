"use client";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { api } from "@roboshare/ui";
import { concat, pad, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import type { Config } from "@wagmi/core";

/** The parts of Safe v1.4.1 the console uses. */
export const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function approveHash(bytes32 hashToApprove)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
]);

export interface QueuedSafeTx {
  id: string;
  safe: Address;
  to: Address;
  data: Hex;
  operation: number;
  description: string;
  calls: { to: Address; data: Hex; description: string }[];
  createdBy: string;
  createdAt: string;
  status: "PENDING" | "EXECUTED" | "CANCELLED";
  safeNonce: number | null;
  execTxHash: string | null;
  closedAt: string | null;
  closeReason: string | null;
}

export interface SafeState {
  owners: Address[];
  threshold: number;
  nonce: number;
}

export async function readSafe(config: Config, safe: Address): Promise<SafeState> {
  const [owners, threshold, nonce] = await Promise.all([
    readContract(config, { address: safe, abi: safeAbi, functionName: "getOwners" }),
    readContract(config, { address: safe, abi: safeAbi, functionName: "getThreshold" }),
    readContract(config, { address: safe, abi: safeAbi, functionName: "nonce" }),
  ]);
  return { owners: [...owners], threshold: Number(threshold), nonce: Number(nonce) };
}

/** Safe transaction hash with no refund parameters (gas is paid by whoever executes). */
export function safeTxHash(config: Config, t: Pick<QueuedSafeTx, "safe" | "to" | "data" | "operation">, nonce: number) {
  return readContract(config, {
    address: t.safe,
    abi: safeAbi,
    functionName: "getTransactionHash",
    args: [t.to, 0n, t.data, t.operation, 0n, 0n, 0n, zeroAddress, zeroAddress, BigInt(nonce)],
  });
}

/** Owners that have approved this hash on-chain. */
export async function approvalsOf(config: Config, safe: Address, owners: Address[], hash: Hex): Promise<Address[]> {
  const marks = await Promise.all(owners.map((o) => readContract(config, { address: safe, abi: safeAbi, functionName: "approvedHashes", args: [o, hash] })));
  return owners.filter((_, i) => marks[i]! > 0n);
}

/**
 * Pre-validated signatures (v = 1): the Safe accepts an owner whose approveHash is on-chain, or the executing owner
 * itself. Owners must be sorted ascending. Returns null while there are not enough.
 */
export function preValidatedSignatures(approved: Address[], executor: Address | undefined, owners: Address[], threshold: number): Hex | null {
  const isOwner = (a: string) => owners.some((o) => o.toLowerCase() === a.toLowerCase());
  const set = new Map(approved.map((a) => [a.toLowerCase(), a]));
  if (executor && isOwner(executor)) set.set(executor.toLowerCase(), executor);
  const signers = [...set.values()].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).slice(0, threshold);
  if (signers.length < threshold) return null;
  return concat(signers.map((s) => concat([pad(s, { size: 32 }), pad("0x0", { size: 32 }), "0x01"]))).toLowerCase() as Hex;
}

/** The nonce a not-yet-numbered transaction should take: after the chain nonce and every numbered pending one. */
export function nextNonce(chainNonce: number, pending: Pick<QueuedSafeTx, "safeNonce">[]): number {
  let n = chainNonce;
  const used = new Set(pending.map((p) => p.safeNonce).filter((x): x is number => x !== null));
  while (used.has(n)) n++;
  return n;
}

/** Chinese title for a queued transaction, from the description the API wrote. */
export function safeTxTitle(description: string): string {
  const d = description.replace(/^Safe( batch)?: /, "");
  const state: Record<string, string> = { ACTIVE: "投入运营", SUSPENDED: "暂停运营", EXIT_PENDING: "进入退出流程", TERMINATED: "终止", FUNDED: "募集完成", VERIFIED: "核验通过", DRAFT: "退回草稿" };
  let m: RegExpMatchArray | null;
  if (d.startsWith("configure and open offering")) return "开启募集";
  if ((m = d.match(/^move project \S+ to (\w+)/))) return `项目状态改为：${state[m[1]!] ?? m[1]}`;
  if (d.startsWith("exclude ")) return "排除认购人并退款";
  if (d === "referral terms on") return "开启邀请奖励";
  if (d === "referral terms off") return "关闭邀请奖励";
  return d;
}

export function usePendingSafeTxs() {
  return useQuery({ queryKey: ["admin", "safe-txs"], refetchInterval: 10_000, queryFn: () => api.get<{ items: QueuedSafeTx[] }>("/admin/safe-txs") });
}
