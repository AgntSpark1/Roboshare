import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectListItem } from "@roboshare/ui";
import { ProjectCard } from "@/components/ProjectCard";
import Risk from "../app/risk/page";
import Guide from "../app/guide/page";
import Faq from "../app/faq/page";
import { EligibilityHelp } from "@/components/Help";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

const ONE = 10n ** 18n;
const base: ProjectListItem = {
  id: `0x${"ab".repeat(32)}`,
  title: "星港 01 号",
  slug: "rs-001",
  make: "示例车型",
  model: "L4",
  state: "OFFERING",
  issuedUnits: 0,
  authorizedUnits: 100,
  offering: { status: "OPEN", unitsSold: 63, minUnits: 60, maxUnits: 100, unitPrice: (520n * ONE).toString(), endAt: new Date(Date.now() + 86_400_000).toISOString() },
};

describe("project card", () => {
  it("links to the project and shows price and live progress while offering", () => {
    render(<ProjectCard p={base} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", `/projects/${base.id}`);
    expect(screen.getByRole("heading", { name: "星港 01 号" })).toBeInTheDocument();
    expect(screen.getByText("520.00 USDT")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "63");
    expect(screen.getAllByText("RS-001").length).toBeGreaterThan(0);
  });

  it("shows issued units once the offering is over", () => {
    render(<ProjectCard p={{ ...base, state: "ACTIVE", issuedUnits: 80, offering: { ...base.offering!, status: "SETTLED" } }} />);
    expect(screen.getByText("80 / 100 份")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("investor notes", () => {
  it("keeps the key warnings and the KYC status", () => {
    render(<Risk />);
    expect(screen.getByRole("heading", { level: 1, name: "投资须知" })).toBeInTheDocument();
    expect(screen.getByText("投资可能亏损，收益不作保证。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未成团全额退款" })).toBeInTheDocument();
    expect(screen.getByText(/尚未接入第三方 KYC\/AML/)).toBeInTheDocument();
    expect(screen.getByText(/不提供任何找回功能/)).toBeInTheDocument();
    expect(screen.getAllByRole("group").length).toBeGreaterThanOrEqual(10);
  });
});

describe("beginner help", () => {
  it("walks through wallet, BEP20 USDT, BNB fees and eligibility with linkable steps", () => {
    const { container } = render(<Guide />);
    expect(screen.getByRole("heading", { level: 1, name: "新手指南" })).toBeInTheDocument();
    for (const id of ["wallet", "usdt", "bnb", "eligibility", "subscribe"]) expect(container.querySelector(`#${id}`)).not.toBeNull();
    expect(screen.getByText(/BEP20）。选错网络/)).toBeInTheDocument();
  });

  it("answers the common questions without promising a buyback", () => {
    render(<Faq />);
    expect(screen.getByRole("heading", { level: 1, name: "常见问题" })).toBeInTheDocument();
    expect(screen.getByText(/平台不承诺回购/)).toBeInTheDocument();
  });

  it("tells an ineligible investor what to do next", () => {
    render(<EligibilityHelp wallet="0x06cD41Dd6E7a59fC057954FA6a81Abe76522f820" />);
    expect(screen.getByRole("button", { name: "复制我的钱包地址" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "新手指南" })).toHaveAttribute("href", "/guide#eligibility");
  });
});
