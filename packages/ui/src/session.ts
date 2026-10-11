"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getChainId, signMessage } from "@wagmi/core";
import { useAccount, useWalletConfig } from "./wallet";
import { createSiweMessage } from "viem/siwe";
import { api, ApiError } from "./api";
import { useUiStrings } from "./i18n";

export interface Me {
  userId: string;
  wallet: `0x${string}`;
  wallets: `0x${string}`[];
  eligibility: { status: string; expiresAt: string | null };
  isStaff: boolean;
}

export const SESSION_KEY = ["auth", "me"] as const;

/** The signed-in session (SIWE cookie), or null. Only counts when it belongs to the connected wallet. */
export function useSession() {
  const { address } = useAccount();
  const q = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
  const me = q.data && address && q.data.wallet.toLowerCase() === address.toLowerCase() ? q.data : null;
  return { me, loading: q.isLoading, refetch: q.refetch };
}

/** Sign-In with Ethereum: nonce from the API, message for this site's host, signature from the wallet. */
export function useSignIn() {
  const { address } = useAccount();
  const config = useWalletConfig();
  const qc = useQueryClient();
  const t = useUiStrings();
  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error(t.connectFirst);
      const { nonce } = await api.get<{ nonce: string }>(`/auth/nonce?address=${address}`);
      const message = createSiweMessage({
        address,
        chainId: getChainId(config),
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: t.siweStatement,
      });
      const signature = await signMessage(config, { message });
      await api.post("/auth/verify", { message, signature });
      await qc.invalidateQueries();
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
      qc.setQueryData(SESSION_KEY, null);
      await qc.invalidateQueries();
    },
  });
}
