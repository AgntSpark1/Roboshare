"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WalletProvider } from "./wallet";
import { makeWagmiConfig, type WalletEnv } from "./wagmi";

export function Web3Providers({ env, children }: { env: WalletEnv; children: ReactNode }) {
  const [config] = useState(() => makeWagmiConfig(env));
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <WalletProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WalletProvider>
  );
}
