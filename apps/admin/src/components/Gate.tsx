"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, ApiError, shortAddr, useAccount, useSession, useSignOut, useDisconnect, WalletButton } from "@roboshare/ui";
import { CHAIN_NAME, walletEnv } from "@/env";
import { errorText, ROLE_LABEL, useAdminMe } from "@/lib/admin";

const NAV: { href: string; label: string; group: string }[] = [
  { href: "/", label: "概览", group: "运营" },
  { href: "/projects", label: "车辆项目", group: "运营" },
  { href: "/offerings", label: "募集结算", group: "运营" },
  { href: "/reports", label: "财务报告", group: "资金" },
  { href: "/distributions", label: "分配批次", group: "资金" },
  { href: "/governance", label: "治理提案", group: "治理" },
  { href: "/roles", label: "角色与权限", group: "治理" },
  { href: "/audit", label: "对账与审计日志", group: "治理" },
];

export function Gate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const { me, loading } = useSession();
  const admin = useAdminMe();
  if (!isConnected || !me || loading) return <Login step={!isConnected ? 1 : 2} />;
  if (admin.isLoading) return <Login step={2} busy />;
  if (admin.error) {
    const notStaff = admin.error instanceof ApiError && admin.error.status === 403;
    return <Login step={2} error={notStaff ? "这个钱包不是运营人员账户，或链上没有对应角色。" : errorText(admin.error)} />;
  }
  if (admin.data === null) return <Login step={3} />;
  return <Shell>{children}</Shell>;
}

function Login({ step, busy, error }: { step: 1 | 2 | 3; busy?: boolean; error?: string }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSending(true);
    try {
      await api.post("/auth/staff/totp", { code });
      await qc.invalidateQueries({ queryKey: ["admin"] });
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setSending(false);
    }
  }
  const st = (n: number) => (step > n ? "lstep done" : "lstep");
  return (
    <main className="login" id="main">
      <div className="lcard">
        <div>
          <div className="eyebrow">ROBOSHARE · OPERATIONS</div>
          <h1 style={{ marginTop: 6 }}>运营控制台</h1>
          <p className="muted small" style={{ marginTop: 6 }}>仅限运营、审核与治理人员。所有资金操作都由你的钱包签名，服务器从不代签。</p>
        </div>
        <div className={st(1)}><span className="n">1</span><span>连接运营钱包</span>{step === 1 && <WalletButton />}</div>
        <div className={st(2)}>
          <span className="n">2</span>
          <span>签名登录（SIWE）</span>
          {step === 2 && !busy && !error && <WalletButton signInLabel="签名登录" />}
          {busy && <span className="spin" aria-label="检查权限中" />}
        </div>
        <div className={st(3)}>
          <span className="n">3</span>
          <span>身份验证器二次确认</span>
        </div>
        {step === 3 && (
          <form className="form" onSubmit={verify}>
            <label className="field">
              <span>6 位验证码</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-describedby="otp-help"
              />
            </label>
            <span id="otp-help" className="muted small">打开身份验证器 App 查看 RoboShare 的验证码。每个验证码只能用一次，确认后 15 分钟内有效。</span>
            <button type="submit" className="btn primary" disabled={code.length !== 6 || sending}>确认</button>
            {err && <p className="err" role="alert">{err}</p>}
          </form>
        )}
        {error && (
          <div className="stack" style={{ gap: 8 }}>
            <p className="err" role="alert">{error}</p>
            <SignOutButton />
          </div>
        )}
        <p className="muted small">网络：{CHAIN_NAME[walletEnv.chainId] ?? walletEnv.chainId}（{walletEnv.chainId}）</p>
      </div>
    </main>
  );
}

function SignOutButton() {
  const signOut = useSignOut();
  const disconnect = useDisconnect();
  return (
    <button type="button" className="btn sm" onClick={() => signOut.mutate(undefined, { onSuccess: () => void disconnect() })}>
      退出并换一个钱包
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const admin = useAdminMe();
  const on = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  const groups = [...new Set(NAV.map((n) => n.group))];
  const title = NAV.find((n) => on(n.href))?.label ?? "运营控制台";
  return (
    <div className="shell">
      <nav className="rail" aria-label="控制台模块">
        <div className="brand">
          <span>RoboShare<small>OPERATIONS</small></span>
        </div>
        {groups.map((g) => (
          <div key={g}>
            <div className="grp">{g}</div>
            {NAV.filter((n) => n.group === g).map((n) => (
              <Link key={n.href} href={n.href} className={on(n.href) ? "on" : ""} aria-current={on(n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </div>
        ))}
        <div className="who-box">
          <span className="mono">{shortAddr(admin.data?.wallet)}</span>
          <div className="roles-list">
            {(admin.data?.roles ?? []).map((r) => <span className="lab" key={r}>{ROLE_LABEL[r]}</span>)}
          </div>
          <SignOutButton />
        </div>
      </nav>
      <div className="main">
        <nav className="chips" aria-label="控制台模块（窄屏）">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={on(n.href) ? "on" : ""} aria-current={on(n.href) ? "page" : undefined}>{n.label}</Link>
          ))}
        </nav>
        <header className="bar">
          <h1>{title}</h1>
          <span className="spacer" />
          <span className="net"><i aria-hidden="true" />{CHAIN_NAME[walletEnv.chainId] ?? walletEnv.chainId} · {walletEnv.chainId}</span>
          <span className="who">{(admin.data?.roles ?? []).map((r) => ROLE_LABEL[r].slice(0, 2)).join(" · ")} · <span className="mono">{shortAddr(admin.data?.wallet)}</span></span>
        </header>
        <main className="work" id="main">{children}</main>
      </div>
    </div>
  );
}
