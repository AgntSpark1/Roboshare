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
