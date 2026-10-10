import type { Abi, Address } from "viem";
import { encodeFunctionData } from "viem";

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
