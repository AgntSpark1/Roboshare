"use client";
import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { subscriptionRouterAbi } from "@roboshare/shared";
import { api, useSession, useWalletConfig } from "@roboshare/ui";
import { usePaymentSetup } from "@/lib/data";

const KEY = "roboshare.ref";

/** The `ref` invite parameter, if it is a valid address other than the visitor's own wallet. */
export function parseRef(search: string, self?: string): Address | null {
  const raw = new URLSearchParams(search).get("ref");
  if (!raw || !isAddress(raw)) return null;
  const ref = getAddress(raw);
  return self && ref.toLowerCase() === self.toLowerCase() ? null : ref;
}

/** Remembers the inviter from the landing URL. The chain only binds it on the first subscription. */
export function captureReferrer(search: string) {
  const ref = parseRef(search);
  if (!ref) return;
  try {
    localStorage.setItem(KEY, ref);
  } catch {
    // storage blocked: the invite still works if the link is opened again before buying
  }
}

export function storedReferrer(self?: string): Address | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  return raw ? parseRef(`?ref=${raw}`, self) : null;
}

export function inviteLink(origin: string, wallet: string) {
  return `${origin}/?ref=${getAddress(wallet)}`;
}

/** Whether governance has switched referral binding on (off by default; see REFERRAL_DESIGN.md). */
export function useReferralsEnabled() {
  const config = useWalletConfig();
  const { router } = usePaymentSetup();
  return useQuery({
    queryKey: ["referrals-enabled", router],
    enabled: !!router,
    queryFn: () => readContract(config, { address: router!, abi: subscriptionRouterAbi, functionName: "referralsEnabled" }) as Promise<boolean>,
  });
}

export interface MyReferrals {
  wallet: Address;
  contract: Address | null;
  referredBy: { referrer: Address; shareBps: number; expiresAt: string } | null;
  referees: { wallet: Address; shareBps: number; expiresAt: string; earned: string }[];
  earned: string;
  claimed: string;
  pendingPublication: string;
  claimable: { cumulative: string; amount: string; proof: Hex[]; epoch: number } | null;
}

export function useMyReferrals() {
  const { me } = useSession();
  return useQuery({ queryKey: ["me", "referrals", me?.wallet], enabled: !!me, queryFn: () => api.get<MyReferrals>("/me/referrals") });
}
