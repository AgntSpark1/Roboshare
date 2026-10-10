"use client";
import { useState } from "react";
import { useAccount, useConnect, useConnectors, useDisconnect } from "../wallet";
import { Modal } from "./Modal";
import { shortAddr } from "../format";
import { useSession, useSignIn, useSignOut } from "../session";
import { TEST_WALLET_PREFIX } from "../wagmi";

/** Connect, sign in (SIWE) and sign out. Test wallets appear only on a local anvil chain. */
export function WalletButton({ signInLabel = "签名登录" }: { signInLabel?: string }) {
  const { address, isConnected } = useAccount();
  const connectors = useConnectors();
  const { connect, pending: isPending, error } = useConnect();
  const disconnect = useDisconnect();
  const { me } = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);

  if (!isConnected) {
    return (
      <>
        <button type="button" className="btn primary wallet" onClick={() => setOpen(true)}>连接钱包</button>
        {open && (
          <Modal title="连接钱包" onClose={() => setOpen(false)}>
            <div className="wallets">
              {connectors.map((c) => {
                const test = c.id.startsWith(TEST_WALLET_PREFIX);
                const acct = test ? c.id.slice(TEST_WALLET_PREFIX.length) : "";
                return (
                  <button
                    type="button"
                    key={c.uid}
                    disabled={isPending}
                    onClick={async () => (await connect(c)) && setOpen(false)}
                  >
                    <span className="wl" style={{ background: test ? "#8B7BFF" : "#F6B53D" }} aria-hidden="true">{test ? "T" : "W"}</span>
                    <span>
                      <b>{test ? `测试钱包 ${shortAddr(acct)}` : c.name === "Injected" ? "浏览器钱包" : c.name}</b>
                      <br />
                      <small className="muted">{test ? "仅本地测试链（TEST-ONLY）" : "MetaMask、OKX、Trust 等"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            {error && <p className="err" role="alert">{error.message}</p>}
          </Modal>
        )}
      </>
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
        {signIn.error && <span className="err" role="alert">{signIn.error.message.split("\n")[0]}</span>}
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
