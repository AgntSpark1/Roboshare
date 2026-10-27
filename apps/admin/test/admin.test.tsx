import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Web3Providers, type SafeProposal } from "@roboshare/ui";
import { Gate } from "@/components/Gate";
import { ProposalView } from "@/components/Proposal";
import { TeamView, type TeamDetail } from "@/components/TeamView";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const tx = (data: string) => ({ chainId: 31337, to: "0x00000000000000000000000000000000000071e0" as const, data: data as `0x${string}`, value: "0" as const, description: "x" });

describe("Safe proposal", () => {
  it("lists each call for the Safe, says it takes effect at once, and never sends anything", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const p: SafeProposal = {
      safe: "0x00000000000000000000000000000000000005af",
      calls: [
        { to: "0x00000000000000000000000000000000000000a1", data: "0x01020304", description: "configure" },
        { to: "0x00000000000000000000000000000000000000a1", data: "0x05060708", description: "open" },
      ],
      tx: { ...tx("0x8d80ff0a"), operation: 1 },
    };
    render(<ProposalView proposal={p} />);
    expect(screen.getByText(/3 人中 2 人签名/)).toBeInTheDocument();
    expect(screen.getByText("立即生效")).toBeInTheDocument();
    expect(screen.queryByText(/24 小时/)).not.toBeInTheDocument();
    expect(screen.getByText("0x01020304")).toBeInTheDocument();
    expect(screen.getByText("0x05060708")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "复制 calldata" })[0]!);
    expect(writeText).toHaveBeenCalledWith("0x01020304");
  });
});

describe("console gate", () => {
  it("asks staff to connect a wallet before showing any module", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "x" } }), { status: 401 })));
    render(
      <Web3Providers env={{ chainId: 31337, testWallets: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"] }}>
        <Gate><p>secret module</p></Gate>
      </Web3Providers>,
    );
    expect(screen.getByRole("heading", { name: "运营控制台" })).toBeInTheDocument();
    expect(screen.getByText("连接运营钱包")).toBeInTheDocument();
    expect(screen.queryByText("secret module")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "连接钱包" }));
    expect(screen.getByRole("button", { name: /测试钱包 0x3c44/i })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("team leader back office", () => {
  it("asks only for a wallet sign-in, never the staff authenticator", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "x" } }), { status: 401 })));
    pathname = "/leader";
    render(
      <Web3Providers env={{ chainId: 31337, testWallets: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"] }}>
        <Gate><p>team module</p></Gate>
      </Web3Providers>,
    );
    expect(screen.getByRole("heading", { name: "团队后台" })).toBeInTheDocument();
    expect(screen.getByText("连接团队长钱包")).toBeInTheDocument();
    expect(screen.queryByText("身份验证器二次确认")).not.toBeInTheDocument();
    expect(screen.queryByText("team module")).not.toBeInTheDocument();
    pathname = "/";
    vi.unstubAllGlobals();
  });

  it("shows the team link, totals and each member's generation", () => {
    const d: TeamDetail = {
      team: { id: "t", code: "A01", name: "华东一队", leader: "0x00000000000000000000000000000000000000a1", note: null, createdAt: "2026-10-26T00:00:00Z" },
      totals: { members: 2, investors: 2, invested: "3000000000000000000000", rewards: "0", fee: "0", city: "20000000000000000000", cityUnits: 20 },
      members: [
        { wallet: "0x00000000000000000000000000000000000000a1", depth: 0, invitedBy: null, joinedAt: null, invites: 1, invested: "1000000000000000000000", rewards: "0", fee: "0", city: "0", cityUnits: 0 },
        { wallet: "0x00000000000000000000000000000000000000b2", depth: 1, invitedBy: "0x00000000000000000000000000000000000000a1", joinedAt: null, invites: 0, invested: "2000000000000000000000", rewards: "0", fee: "0", city: "20000000000000000000", cityUnits: 20 },
      ],
    };
    render(<TeamView d={d} />);
    expect(screen.getByTestId("team-link")).toHaveTextContent("/t/A01");
    expect(screen.getByRole("cell", { name: "团队长" })).toBeInTheDocument();
    expect(screen.getByText("第 1 代")).toBeInTheDocument();
    expect(screen.getByTestId("team-city")).toHaveTextContent("20 份");
  });
});
