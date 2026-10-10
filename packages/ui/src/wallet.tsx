"use client";
/**
 * Minimal React bindings over @wagmi/core. We only need injected wallets and TEST-ONLY anvil wallets, so we skip
 * the `wagmi` React package and its WalletConnect/SDK dependency tree.
 */
import {
  connect as coreConnect,
  disconnect as coreDisconnect,
  getAccount,
  getConnectors,
  reconnect,
  switchChain as coreSwitchChain,
  watchAccount,
  watchConnectors,
  type Config,
  type Connector,
  type GetAccountReturnType,
} from "@wagmi/core";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const Ctx = createContext<Config | null>(null);

export function WalletProvider({ config, children }: { config: Config; children: ReactNode }) {
  useEffect(() => {
    void reconnect(config);
  }, [config]);
  return <Ctx.Provider value={config}>{children}</Ctx.Provider>;
}

export function useWalletConfig(): Config {
  const c = useContext(Ctx);
  if (!c) throw new Error("WalletProvider is missing");
  return c;
}

function useStore<T>(subscribe: (cb: () => void) => () => void, read: () => T, server: T): T {
  const cache = useRef<{ v: T } | null>(null);
  const sub = useCallback(
    (cb: () => void) =>
      subscribe(() => {
        cache.current = { v: read() };
        cb();
      }),
    [subscribe, read],
  );
  const get = useCallback(() => (cache.current ??= { v: read() }).v, [read]);
  return useSyncExternalStore(sub, get, () => server);
}

const DISCONNECTED = { address: undefined, isConnected: false, status: "disconnected" } as unknown as GetAccountReturnType;

export function useAccount(): GetAccountReturnType {
  const config = useWalletConfig();
  const subscribe = useCallback((cb: () => void) => watchAccount(config, { onChange: cb }), [config]);
  const read = useCallback(() => getAccount(config), [config]);
  return useStore(subscribe, read, DISCONNECTED);
}

export function useConnectors(): readonly Connector[] {
  const config = useWalletConfig();
  const subscribe = useCallback((cb: () => void) => watchConnectors(config, { onChange: cb }), [config]);
  const read = useCallback(() => getConnectors(config), [config]);
  return useStore(subscribe, read, []);
}

export function useConnect() {
  const config = useWalletConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const connect = useCallback(
    async (connector: Connector) => {
      setPending(true);
      setError(null);
      try {
        await coreConnect(config, { connector });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        return false;
      } finally {
        setPending(false);
      }
    },
    [config],
  );
  return { connect, pending, error };
}

export function useDisconnect() {
  const config = useWalletConfig();
  return useCallback(() => coreDisconnect(config), [config]);
}

/** The chain this site runs on (the config has exactly one). */
export function useTargetChain() {
  return useWalletConfig().chains[0];
}

/** Moves the wallet to this site's chain, adding the network to the wallet first if it does not know it yet. */
export function useSwitchChain() {
  const config = useWalletConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const switchChain = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await coreSwitchChain(config, { chainId: config.chains[0].id });
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setPending(false);
    }
  }, [config]);
  return { switchChain, pending, error };
}

/** Plain-Chinese reason for a wallet failure; raw wallet messages are English and full of RPC detail. */
export function walletErrorMessage(e: unknown): string {
  const chain: { name?: string; code?: number; message?: string }[] = [];
  for (let x = e as { name?: string; code?: number; message?: string; cause?: unknown } | undefined; x && chain.length < 8; x = x.cause as typeof x) chain.push(x);
  const has = (name: string, code?: number) => chain.some((x) => x.name === name || (code !== undefined && x.code === code));
  if (has("UserRejectedRequestError", 4001)) return "你在钱包里取消了这次请求";
  if (has("ProviderNotFoundError")) return "没有检测到钱包。请在钱包 App 里打开本页，或在电脑浏览器安装 MetaMask。";
  if (has("ResourceUnavailableRpcError", -32002)) return "钱包里还有一个待处理的请求，请打开钱包 App 处理后再试";
  if (has("ConnectorChainMismatchError") || has("ChainNotConfiguredError")) return "钱包所在的网络不对，请先切换到本站使用的网络";
  if (has("SwitchChainError") || has("UnsupportedChainIdError", 4902)) return "钱包没能切换网络，请在钱包里手动切换后再试";
  const first = chain[0]?.message?.split("\n")[0];
  return first ? `出错了：${first}` : "出错了，请重试";
}
