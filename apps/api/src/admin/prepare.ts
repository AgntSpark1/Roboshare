import { randomUUID } from "node:crypto";
import { encodeFunctionData, keccak256, parseAbi, stringToHex, type Abi, type Address } from "viem";

/** An unsigned transaction for a staff wallet or a Safe proposal. The server never signs it. */
export interface PreparedTx {
  chainId: number;
  to: Address;
  data: `0x${string}`;
  value: "0";
  description: string;
}

export function prepare(chainId: number, to: Address, abi: Abi, functionName: string, args: unknown[], description: string): PreparedTx {
  return { chainId, to, data: encodeFunctionData({ abi, functionName, args } as any), value: "0", description };
}

const timelockAbi = parseAbi([
  "function schedule(address target, uint256 value, bytes data, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function execute(address target, uint256 value, bytes payload, bytes32 predecessor, bytes32 salt)",
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt)",
]);

export interface Call {
  to: Address;
  data: `0x${string}`;
}

export interface TimelockProposal {
  timelock: Address;
  salt: `0x${string}`;
  delaySeconds: number;
  calls: Call[];
  /** For the governance Safe to propose now (2-of-3 signatures, D-16). */
  schedule: PreparedTx;
  /** For the Safe to execute after the delay. */
  execute: PreparedTx;
}

/** Wraps governance calls in TimelockController.schedule/execute. Nothing is signed or sent. */
export function viaTimelock(chainId: number, timelock: Address, delaySeconds: number, calls: Call[], what: string): TimelockProposal {
  const salt = keccak256(stringToHex(`${what}:${randomUUID()}`));
  const zero = `0x${"00".repeat(32)}` as const;
  const delay = BigInt(delaySeconds);
  const single = calls.length === 1;
  const [first] = calls;
  const scheduleData = single
    ? encodeFunctionData({ abi: timelockAbi, functionName: "schedule", args: [first!.to, 0n, first!.data, zero, salt, delay] })
    : encodeFunctionData({ abi: timelockAbi, functionName: "scheduleBatch", args: [calls.map((c) => c.to), calls.map(() => 0n), calls.map((c) => c.data), zero, salt, delay] });
  const executeData = single
    ? encodeFunctionData({ abi: timelockAbi, functionName: "execute", args: [first!.to, 0n, first!.data, zero, salt] })
    : encodeFunctionData({ abi: timelockAbi, functionName: "executeBatch", args: [calls.map((c) => c.to), calls.map(() => 0n), calls.map((c) => c.data), zero, salt] });
  return {
    timelock,
    salt,
    delaySeconds,
    calls,
    schedule: { chainId, to: timelock, data: scheduleData, value: "0", description: `Safe: schedule ${what}` },
    execute: { chainId, to: timelock, data: executeData, value: "0", description: `Safe: execute ${what} after ${delaySeconds}s` },
  };
}

export const call = (to: Address, abi: Abi, functionName: string, args: unknown[]): Call => ({
  to,
  data: encodeFunctionData({ abi, functionName, args } as any),
});
