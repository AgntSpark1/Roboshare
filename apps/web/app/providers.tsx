"use client";
import { Web3Providers } from "@roboshare/ui";
import { useEffect, type ReactNode } from "react";
import { walletEnv } from "@/env";
import { captureReferrer } from "@/lib/referral";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => captureReferrer(window.location.search), []);
  return <Web3Providers env={walletEnv}>{children}</Web3Providers>;
}
