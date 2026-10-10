import type { Address } from "viem";

/** anvil's default accounts (mnemonic "test test ... junk"). TEST-ONLY; never funded on a real network. */
export const ANVIL = [
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720",
] as const satisfies readonly Address[];

/** Same role layout as apps/worker/test/anvil.ts. */
export const ROLES = {
  deployer: ANVIL[0],
  safe: ANVIL[1],
  operator: ANVIL[2],
  reviewer: ANVIL[3],
  pauser: ANVIL[4],
  agent: ANVIL[5],
  feeRecipient: ANVIL[6],
  alice: ANVIL[7],
  bob: ANVIL[8],
  treasury: ANVIL[9],
} as const;

export const PORTS = { anvil: 8545, api: 4100, web: 3000, admin: 3001 } as const;

/** Build-time env for both Next apps in e2e mode (local chain, TEST-ONLY wallets). */
export function appEnv(kind: "web" | "admin"): Record<string, string> {
  return {
    API_URL: `http://127.0.0.1:${PORTS.api}`,
    NEXT_PUBLIC_CHAIN_ID: "31337",
    NEXT_PUBLIC_RPC_URL: `http://127.0.0.1:${PORTS.anvil}`,
    NEXT_PUBLIC_TEST_WALLETS: (kind === "web" ? [ROLES.alice, ROLES.bob] : [ROLES.operator, ROLES.reviewer]).join(","),
  };
}
