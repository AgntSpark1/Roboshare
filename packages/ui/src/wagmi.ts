import { createConfig, createConnector, http, injected, mock, type Config } from "@wagmi/core";
import { bsc, bscTestnet, foundry } from "viem/chains";
import type { Address, Chain } from "viem";

export const SUPPORTED_CHAINS: Record<number, Chain> = { 56: bsc, 97: bscTestnet, 31337: foundry };

export interface WalletEnv {
  chainId: number;
  rpcUrl?: string;
  /**
   * TEST-ONLY: unlocked accounts of a local anvil node, exposed as "test wallets" so the e2e suite (and a developer
   * without a browser wallet) can sign. Ignored on any chain other than 31337.
   */
  testWallets?: Address[];
}

export function readWalletEnv(env: Record<string, string | undefined>): WalletEnv {
  return {
    chainId: Number(env.NEXT_PUBLIC_CHAIN_ID ?? 97),
    rpcUrl: env.NEXT_PUBLIC_RPC_URL || undefined,
    testWallets: (env.NEXT_PUBLIC_TEST_WALLETS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Address => /^0x[0-9a-fA-F]{40}$/.test(s)),
  };
}

export function makeWagmiConfig(env: WalletEnv): Config {
  const base = SUPPORTED_CHAINS[env.chainId];
  if (!base) throw new Error(`unsupported chain ${env.chainId}`);
  const chain: Chain = env.rpcUrl ? { ...base, rpcUrls: { default: { http: [env.rpcUrl] } } } : base;
  const tests = env.chainId === 31337 ? env.testWallets ?? [] : [];
  return createConfig({
    chains: [chain],
    ssr: true,
    connectors: [
      injected({ shimDisconnect: true }),
      ...tests.map(testWallet),
    ],
    transports: { [chain.id]: http(env.rpcUrl) },
  });
}

/** TEST-ONLY connector for one unlocked anvil account; the node signs, so no key ever reaches the browser. */
function testWallet(account: Address) {
  const id = `${TEST_WALLET_PREFIX}${account.toLowerCase()}`;
  const base = mock({ accounts: [account], features: { reconnect: true } });
  // The mock connector forgets it was connected on reload; remember the choice so reconnect() restores it.
  const remember = (on: boolean) => {
    try {
      if (on) localStorage.setItem(TEST_WALLET_KEY, id);
      else if (localStorage.getItem(TEST_WALLET_KEY) === id) localStorage.removeItem(TEST_WALLET_KEY);
    } catch {
      // storage unavailable: the wallet simply will not reconnect after a reload
    }
  };
  return createConnector((c) => {
    const b = base(c);
    return {
      ...b,
      id,
      name: `Test wallet ${account}`,
      async connect(p) {
        const r = await b.connect(p as never);
        remember(true);
        return r as never;
      },
      async disconnect() {
        remember(false);
        await b.disconnect();
      },
      async isAuthorized() {
        try {
          return localStorage.getItem(TEST_WALLET_KEY) === id;
        } catch {
          return false;
        }
      },
    };
  });
}

const TEST_WALLET_KEY = "roboshare.testWallet";

export const TEST_WALLET_PREFIX = "anvil-";
