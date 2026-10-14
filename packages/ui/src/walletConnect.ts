/**
 * Scan-to-connect via WalletConnect, as a @wagmi/core connector.
 *
 * Adapted from the `walletConnect` connector in @wagmi/connectors 6.2.0 (MIT, https://github.com/wevm/wagmi). We do not
 * depend on @wagmi/connectors because it bundles every connector SDK it supports, one of which breaks the Next build.
 * Simplified for this app's single configured chain. @walletconnect/ethereum-provider is pinned to 2.21.1, the last
 * Apache-2.0 release (it pins @reown/appkit 1.7.8, also Apache-2.0); later releases changed licence.
 */
import { ChainNotConfiguredError, createConnector, extractRpcUrls, ProviderNotFoundError } from "@wagmi/core";
import { getAddress, numberToHex, SwitchChainError, UserRejectedRequestError, type Address } from "viem";

export interface WalletConnectParameters {
  projectId: string;
  metadata: { name: string; description: string; url: string; icons: string[] };
}

type Provider = Awaited<ReturnType<(typeof import("@walletconnect/ethereum-provider"))["EthereumProvider"]["init"]>>;

walletConnect.type = "walletConnect" as const;

export function walletConnect(parameters: WalletConnectParameters) {
  let provider_: Provider | undefined;
  let providerPromise: Promise<Provider | undefined> | undefined;
  let accountsChanged: ((accounts: string[]) => void) | undefined;
  let chainChanged: ((chain: string) => void) | undefined;
  let disconnect: (() => void) | undefined;
  let sessionDelete: (() => void) | undefined;

  return createConnector<Provider>((config) => ({
    id: "walletConnect",
    name: "WalletConnect",
    type: walletConnect.type,

    async connect({ chainId }: { chainId?: number } = {}) {
      try {
        const provider = await this.getProvider();
        if (!provider) throw new ProviderNotFoundError();
        const target = chainId ?? config.chains[0]?.id;
        if (!target) throw new Error("No chains configured.");
        if (!provider.session) await provider.connect({ optionalChains: [target, ...config.chains.map((c) => c.id).filter((id) => id !== target)] });
        const accounts = (await provider.enable()).map((a) => getAddress(a));
        const current = await this.getChainId();
        if (!accountsChanged) {
          accountsChanged = this.onAccountsChanged.bind(this);
          provider.on("accountsChanged", accountsChanged);
        }
        if (!chainChanged) {
          chainChanged = this.onChainChanged.bind(this);
          provider.on("chainChanged", chainChanged);
        }
        if (!disconnect) {
          disconnect = this.onDisconnect.bind(this);
          provider.on("disconnect", disconnect);
        }
        if (!sessionDelete) {
          sessionDelete = () => this.onDisconnect();
          provider.on("session_delete", sessionDelete);
        }
        return { accounts, chainId: current } as never;
      } catch (error) {
        if (/(user rejected|connection request reset)/i.test((error as Error)?.message)) throw new UserRejectedRequestError(error as Error);
        throw error;
      }
    },

    async disconnect() {
      const provider = await this.getProvider();
      try {
        await provider?.disconnect();
      } catch (error) {
        if (!/No matching key/i.test((error as Error).message)) throw error;
      } finally {
        if (accountsChanged) provider?.removeListener("accountsChanged", accountsChanged);
        if (chainChanged) provider?.removeListener("chainChanged", chainChanged);
        if (disconnect) provider?.removeListener("disconnect", disconnect);
        if (sessionDelete) provider?.removeListener("session_delete", sessionDelete);
        accountsChanged = chainChanged = disconnect = sessionDelete = undefined;
      }
    },

    async getAccounts() {
      const provider = await this.getProvider();
      return (provider?.accounts ?? []).map((a) => getAddress(a)) as readonly Address[];
    },

    async getProvider() {
      if (!provider_) {
        providerPromise ??= (async () => {
          const chains = config.chains.map((c) => c.id);
          if (!chains.length) return undefined;
          // Loaded on first use only, so pages that never open the QR modal do not pay for it.
          const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
          return EthereumProvider.init({
            projectId: parameters.projectId,
            metadata: parameters.metadata,
            showQrModal: true,
            disableProviderPing: true,
            optionalChains: chains as [number, ...number[]],
            rpcMap: Object.fromEntries(config.chains.map((chain) => [chain.id, extractRpcUrls({ chain, transports: config.transports })[0]!])),
          });
        })();
        provider_ = await providerPromise;
        provider_?.events.setMaxListeners(Number.POSITIVE_INFINITY);
      }
      return provider_!;
    },

    async getChainId() {
      const provider = await this.getProvider();
      return provider.chainId;
    },

    async isAuthorized() {
      try {
        return (await this.getAccounts()).length > 0;
      } catch {
        return false;
      }
    },

    async switchChain({ chainId }) {
      const provider = await this.getProvider();
      if (!provider) throw new ProviderNotFoundError();
      const chain = config.chains.find((c) => c.id === chainId);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
      try {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] });
      } catch (err) {
        if (/(user rejected)/i.test((err as Error).message)) throw new UserRejectedRequestError(err as Error);
        try {
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: numberToHex(chainId),
                chainName: chain.name,
                nativeCurrency: chain.nativeCurrency,
                rpcUrls: [...chain.rpcUrls.default.http],
                blockExplorerUrls: chain.blockExplorers?.default.url ? [chain.blockExplorers.default.url] : [],
              },
            ],
          });
        } catch (error) {
          throw new UserRejectedRequestError(error as Error);
        }
      }
      return chain;
    },

    onAccountsChanged(accounts) {
      if (accounts.length === 0) this.onDisconnect();
      else config.emitter.emit("change", { accounts: accounts.map((a) => getAddress(a)) });
    },

    onChainChanged(chain) {
      config.emitter.emit("change", { chainId: Number(chain) });
    },

    async onDisconnect() {
      config.emitter.emit("disconnect");
      const provider = await this.getProvider();
      if (accountsChanged) provider.removeListener("accountsChanged", accountsChanged);
      if (chainChanged) provider.removeListener("chainChanged", chainChanged);
      if (disconnect) provider.removeListener("disconnect", disconnect);
      if (sessionDelete) provider.removeListener("session_delete", sessionDelete);
      accountsChanged = chainChanged = disconnect = sessionDelete = undefined;
    },
  }));
}
