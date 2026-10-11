"use client";
import { useEffect, useState } from "react";
import type { Connector } from "@wagmi/core";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain, useTargetChain, walletErrorMessage } from "../wallet";
import { Modal } from "./Modal";
import { shortAddr } from "../format";
import { useSession, useSignIn, useSignOut } from "../session";
import { TEST_WALLET_PREFIX } from "../wagmi";
import { walletApps } from "../walletApps";
import { useUiStrings } from "../i18n";


/**
 * One wallet per entry: wallets announced through EIP-6963 (with their own name and icon) replace the generic
 * "Injected" entry, which would otherwise open the same wallet a second time.
 */
function walletList(connectors: readonly Connector[]) {
  const announced = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  return connectors.filter((c) => !(announced && c.id === "injected"));
}

/** Connect, switch to this site's network, sign in (SIWE) and sign out. Test wallets appear only on a local anvil chain. */
export function WalletButton({ signInLabel, compact = false }: { signInLabel?: string; compact?: boolean }) {
  const t = useUiStrings();
  const { address, isConnected, chainId } = useAccount();
  const target = useTargetChain();
  const connectors = useConnectors();
  const { connect, pending: isPending, error } = useConnect();
  const switcher = useSwitchChain();
  const disconnect = useDisconnect();
  const { me } = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [page, setPage] = useState<{ href: string; injected: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPage({ href: window.location.href, injected: Boolean((window as { ethereum?: unknown }).ethereum) });
  }, [open]);

  const chainName = t.chainNames[target.id] ?? target.name;

  if (!isConnected) {
    const noWallet = page !== null && !page.injected;
    return (
      <>
        <button type="button" className="btn primary wallet" onClick={() => setOpen(true)} aria-label={compact ? t.connectWallet : undefined}>
          {compact ? t.connectShort : t.connectWallet}
        </button>
        {open && (
          <Modal title={t.connectWallet} onClose={() => setOpen(false)}>
            {noWallet && page && (
              <div className="wallet-apps">
                <p className="muted">{t.noWalletHint}</p>
                <div className="app-grid">
                  {walletApps(page.href, target.id, { binance: t.binanceWallet }).map((w) => (
                    <a key={w.name} className="app" href={w.url}>
                      <img src={w.logo} alt="" width={40} height={40} />
                      <span>{w.name}</span>
                    </a>
                  ))}
                </div>
                <div className="links">
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(page.href);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? t.copied : t.copyUrl}
                  </button>
                </div>
              </div>
            )}
            <div className="wallets">
              {walletList(connectors).map((c) => {
                const test = c.id.startsWith(TEST_WALLET_PREFIX);
                const acct = test ? c.id.slice(TEST_WALLET_PREFIX.length) : "";
                const busy = isPending && choosing === c.uid;
                return (
                  <button
                    type="button"
                    key={c.uid}
                    disabled={isPending}
                    aria-busy={busy}
                    onClick={async () => {
                      setChoosing(c.uid);
                      if (await connect(c)) setOpen(false);
                    }}
                  >
                    {c.icon && !test ? (
                      <img className="wl" src={c.icon} alt="" />
                    ) : (
                      <span className="wl" style={{ background: test ? "#8B7BFF" : "#F6B53D" }} aria-hidden="true">{test ? "T" : "W"}</span>
                    )}
                    <span>
                      <b>{test ? t.testWallet(shortAddr(acct)) : c.name === "Injected" ? t.browserWallet : c.name}</b>
                      <br />
                      <small className="muted">
                        {busy ? t.confirmConnect : test ? t.testOnly : noWallet && c.id === "injected" ? t.noWalletDetected : t.walletsHint}
                      </small>
                    </span>
                    {busy && <span className="spin" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {error && <p className="err" role="alert">{walletErrorMessage(error, t)}</p>}
          </Modal>
        )}
      </>
    );
  }
  const wrongChain = chainId !== undefined && chainId !== target.id;
  if (wrongChain || !me) {
    const err = wrongChain ? switcher.error : signIn.error;
    const busy = wrongChain ? switcher.pending : signIn.isPending;
    // One row: the address chip (tap to disconnect) and the next step. Never wraps, so the header keeps its height.
    return (
      <div className="wallet-group">
        <button type="button" className="btn ghost sm wg-addr" onClick={() => disconnect()} title={t.disconnectWallet} aria-label={t.disconnect(address ?? "")}>
          <span className="avatar" aria-hidden="true" />
          <span className="addr">{shortAddr(address)}</span>
        </button>
        <button
          type="button"
          className="btn primary sm"
          disabled={busy}
          onClick={() => (wrongChain ? void switcher.switchChain() : signIn.mutate())}
        >
          {busy ? <span className="spin" aria-hidden="true" /> : null}
          {wrongChain ? (
            <>
              <span className="wg-long">{t.switchTo(chainName)}</span>
              <span className="wg-short" aria-hidden="true">{t.switchNetwork}</span>
            </>
          ) : (
            signInLabel ?? t.signIn
          )}
        </button>
        {err && <span className="err" role="alert">{walletErrorMessage(err, t)}</span>}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn wallet"
      onClick={() => signOut.mutate(undefined, { onSuccess: () => disconnect() })}
      title={t.signOutTitle}
      aria-label={t.signedIn(address ?? "")}
    >
      <span className="avatar" aria-hidden="true" />
      <span className="addr">{shortAddr(address)}</span>
    </button>
  );
}
