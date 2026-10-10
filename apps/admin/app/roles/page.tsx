"use client";
import { useQuery } from "@tanstack/react-query";
import { keccak256, stringToHex } from "viem";
import { api, shortAddr } from "@roboshare/ui";

const KNOWN: Record<string, string> = Object.fromEntries(
  ["DEFAULT_ADMIN_ROLE", "OPERATOR_ROLE", "REVIEWER_ROLE", "PAUSER_ROLE", "COMPLIANCE_AGENT_ROLE", "PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"].map((r) => [
    r === "DEFAULT_ADMIN_ROLE" ? `0x${"0".repeat(64)}` : keccak256(stringToHex(r)),
    r,
  ]),
);

export default function Roles() {
  const q = useQuery({ queryKey: ["admin", "roles"], queryFn: () => api.get<{ items: { contract: string; role: string; account: string }[] }>("/admin/roles") });
  return (
    <section className="panel" aria-labelledby="r">
      <h2 id="r">链上角色（来自索引的 RoleGranted / RoleRevoked）</h2>
      <div className="tw">
        <table>
          <thead><tr><th>角色</th><th>账户</th><th>合约</th></tr></thead>
          <tbody>
            {(q.data?.items ?? []).map((g, i) => (
              <tr key={i}>
                <td>{KNOWN[g.role] ?? shortAddr(g.role, 10, 6)}</td>
                <td className="mono">{shortAddr(g.account)}</td>
                <td className="hash">{shortAddr(g.contract)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>授予或撤销角色需要治理 Safe 通过时间锁执行。</p>
    </section>
  );
}
