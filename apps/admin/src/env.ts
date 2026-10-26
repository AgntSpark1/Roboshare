import type { WalletEnv } from "@roboshare/ui";

// NEXT_PUBLIC_* values are inlined at build time, so each one is referenced literally.
export const walletEnv: WalletEnv = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || undefined,
  testWallets: (process.env.NEXT_PUBLIC_TEST_WALLETS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(s)),
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || undefined,
};

export const EXPLORER: Record<number, string | undefined> = { 56: "https://bscscan.com", 97: "https://testnet.bscscan.com" };
export const explorer = EXPLORER[walletEnv.chainId];
export const isTestChain = walletEnv.chainId !== 56;
export const CHAIN_NAME: Record<number, string> = { 56: "BNB Smart Chain", 97: "BSC 测试网", 31337: "本地测试链" };
export const RISK_VERSION = "2026-10";
/** Investor site origin for team links (e.g. https://roboshare.io); empty shows the path only. */
export const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? "").replace(/\/+$/, "");
export const teamLink = (code: string) => `${WEB_URL}/t/${code}`;
