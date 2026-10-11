"use client";
import { useEffect, useState } from "react";
import type { Connector } from "@wagmi/core";
import { useAccount, useConnect, useConnectors, useDisconnect, useSwitchChain, useTargetChain, walletErrorMessage } from "../wallet";
import { Modal } from "./Modal";
import { shortAddr } from "../format";
import { useSession, useSignIn, useSignOut } from "../session";
import { TEST_WALLET_PREFIX } from "../wagmi";
import { walletApps } from "../walletApps";

const CHAIN_LABEL: Record<number, string> = { 56: "BNB 智能链", 97: "BSC 测试网", 31337: "本地测试链" };

/**
 * One wallet per entry: wallets announced through EIP-6963 (with their own name and icon) replace the generic
 * "Injected" entry, which would otherwise open the same wallet a second time.
 */
function walletList(connectors: readonly Connector[]) {
  const announced = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  return connectors.filter((c) => !(announced && c.id === "injected"));
}

/** Connect, switch to this site's network, sign in (SIWE) and sign out. Test wallets appear only on a local anvil chain. */
export function WalletButton({ signInLabel = "签名登录" }: { signInLabel?: string }) {
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

  const chainName = CHAIN_LABEL[target.id] ?? target.name;

  if (!isConnected) {
    const noWallet = page !== null && !page.injected;
    return (
      <>
        <button type="button" className="btn primary wallet" onClick={() => setOpen(true)}>连接钱包</button>
        {open && (
          <Modal title="连接钱包" onClose={() => setOpen(false)}>
            {noWallet && page && (
              <div className="wallet-apps">
                <p className="muted">这个浏览器里没有钱包。手机上请用下面的钱包 App 打开本页，再点“连接钱包”。</p>
                <div className="app-grid">
                  {walletApps(page.href, target.id).map((w) => (
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
                    {copied ? "已复制" : "复制网址"}
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
                      <b>{test ? `测试钱包 ${shortAddr(acct)}` : c.name === "Injected" ? "浏览器钱包" : c.name}</b>
                      <br />
                      <small className="muted">
                        {busy ? "请在钱包里确认连接…" : test ? "仅本地测试链（TEST-ONLY）" : noWallet && c.id === "injected" ? "未检测到钱包" : "MetaMask、币安、OKX、TokenPocket、Bitget、Trust 等"}
                      </small>
                    </span>
                    {busy && <span className="spin" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {error && <p className="err" role="alert">{walletErrorMessage(error)}</p>}
          </Modal>
        )}
      </>
    );
  }
  const wrongChain = chainId !== undefined && chainId !== target.id;
  if (wrongChain) {
    return (
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={switcher.pending} onClick={() => void switcher.switchChain()}>
          {switcher.pending ? <span className="spin" aria-hidden="true" /> : null}
          切换到{chainName}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => disconnect()} aria-label={`断开 ${address}`}>
          {shortAddr(address)}
        </button>
        {switcher.error && <span className="err" role="alert">{walletErrorMessage(switcher.error)}</span>}
      </div>
    );
  }
  if (!me) {
    return (
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={signIn.isPending} onClick={() => signIn.mutate()}>
          {signIn.isPending ? <span className="spin" aria-hidden="true" /> : null}
          {signInLabel}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => disconnect()} aria-label={`断开 ${address}`}>
          {shortAddr(address)}
        </button>
        {signIn.error && <span className="err" role="alert">{walletErrorMessage(signIn.error)}</span>}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="btn wallet"
      onClick={() => signOut.mutate(undefined, { onSuccess: () => disconnect() })}
      title="退出登录并断开钱包"
      aria-label={`已登录 ${address}，点击退出`}
    >
      <span className="avatar" aria-hidden="true" />
      <span className="addr">{shortAddr(address)}</span>
    </button>
  );
}
