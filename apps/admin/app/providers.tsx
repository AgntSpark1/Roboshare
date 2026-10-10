"use client";
import { Web3Providers } from "@roboshare/ui";
import type { ReactNode } from "react";
import { walletEnv } from "@/env";

export function Providers({ children }: { children: ReactNode }) {
  return <Web3Providers env={walletEnv}>{children}</Web3Providers>;
}
