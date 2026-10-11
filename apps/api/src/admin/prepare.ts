import { concat, encodeFunctionData, encodePacked, parseAbi, size, type Abi, type Address } from "viem";

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

export interface Call {
  to: Address;
  data: `0x${string}`;
}

/** Safe v1.4.1 MultiSendCallOnly, same address on every chain (checked on BSC 56 and 97). Used via DELEGATECALL. */
export const MULTISEND_CALL_ONLY: Address = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

export interface SafeProposal {
  /** The 2/3 governance Safe (D-16). It holds admin directly; there is no timelock, so it takes effect once executed. */
  safe: Address;
  /** Each call, for adding one by one in the Safe{Wallet} Transaction Builder (which batches them). */
  calls: (Call & { description: string })[];
  /** The same thing as one Safe transaction: the call itself, or a MultiSendCallOnly batch (operation 1). */
  tx: PreparedTx & { operation: 0 | 1 };
}

/** Wraps governance calls for the Safe. Nothing is signed or sent; two owners sign and it executes at once. */
export function viaSafe(chainId: number, safe: Address, calls: (Call & { description?: string })[], what: string): SafeProposal {
  const described = calls.map((c, i) => ({ ...c, description: c.description ?? `${what} (${i + 1}/${calls.length})` }));
  if (calls.length === 1) {
    const [c] = calls;
    return { safe, calls: described, tx: { chainId, to: c!.to, data: c!.data, value: "0", description: `Safe: ${what}`, operation: 0 } };
  }
  // MultiSend packing per call: operation (uint8, 0 = CALL), to (20 bytes), value (uint256), data length (uint256), data.
  const packed = calls.map((c) => encodePacked(["uint8", "address", "uint256", "uint256", "bytes"], [0, c.to, 0n, BigInt(size(c.data)), c.data]));
  const data = encodeFunctionData({ abi: multiSendAbi, functionName: "multiSend", args: [concat(packed)] });
  return { safe, calls: described, tx: { chainId, to: MULTISEND_CALL_ONLY, data, value: "0", description: `Safe batch: ${what}`, operation: 1 } };
}

export const call = (to: Address, abi: Abi, functionName: string, args: unknown[]): Call => ({
  to,
  data: encodeFunctionData({ abi, functionName, args } as any),
});
