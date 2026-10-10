import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureReferrer, inviteLink, parseRef, storedReferrer } from "@/lib/referral";

const A = "0x00000000000000000000000000000000000000A1";
const ME = "0x00000000000000000000000000000000000000b2";

describe("invite links", () => {
  beforeEach(() => localStorage.clear());

  it("accepts only a valid address that is not the visitor", () => {
    expect(parseRef(`?ref=${A.toLowerCase()}`)).toBe(A);
    expect(parseRef("?ref=nope")).toBeNull();
    expect(parseRef("")).toBeNull();
    expect(parseRef(`?ref=${ME}`, ME.toUpperCase().replace("0X", "0x"))).toBeNull();
  });

  it("remembers the inviter from the landing URL", () => {
    captureReferrer("?utm=x");
    expect(storedReferrer()).toBeNull();
    captureReferrer(`?ref=${A}`);
    expect(storedReferrer(ME)).toBe(A);
    expect(storedReferrer(A)).toBeNull(); // never refer yourself
  });

  it("builds a checksummed link", () => {
    expect(inviteLink("https://app.roboshare.test", A.toLowerCase())).toBe(`https://app.roboshare.test/?ref=${A}`);
  });
});

const refState = vi.hoisted(() => ({ enabled: true as boolean | undefined, data: undefined as unknown }));
vi.mock("@/lib/referral", async (orig) => ({
  ...(await orig<typeof import("@/lib/referral")>()),
  useReferralsEnabled: () => ({ data: refState.enabled }),
  useMyReferrals: () => ({ data: refState.data }),
}));
vi.mock("@/lib/data", () => ({ useRefreshAfterTx: () => () => undefined }));
vi.mock("@roboshare/ui", async (orig) => ({
  ...(await orig<typeof import("@roboshare/ui")>()),
  useTxRunner: () => ({ run: { states: [], running: false }, start: vi.fn() }),
}));

const { ReferralPanel } = await import("@/components/ReferralPanel");
const ONE = 10n ** 18n;
const mine = {
  wallet: ME,
  contract: "0x00000000000000000000000000000000000004eF",
  referredBy: null,
  referees: [{ wallet: A, shareBps: 2_000, expiresAt: "2027-10-10T00:00:00.000Z", earned: (16n * ONE).toString() }],
  earned: (16n * ONE).toString(),
  claimed: "0",
  pendingPublication: "0",
  claimable: { cumulative: (16n * ONE).toString(), amount: (16n * ONE).toString(), proof: [], epoch: 1 },
};

describe("referral panel", () => {
  it("stays hidden while the programme is switched off", () => {
    refState.enabled = false;
    refState.data = mine;
    const { container } = render(<ReferralPanel wallet={ME} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the invite link, the single-tier rule and the claimable reward", () => {
    refState.enabled = true;
    refState.data = mine;
    render(<ReferralPanel wallet={ME} />);
    expect(screen.getByTestId("invite-link").textContent).toContain(`?ref=${ME}`);
    expect(screen.getByText(/只有一层邀请/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "领取 16.00 USDT" })).toBeEnabled();
  });
});
