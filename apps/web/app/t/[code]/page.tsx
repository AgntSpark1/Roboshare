import { redirect } from "next/navigation";
import { getAddress, isAddress } from "viem";

export const dynamic = "force-dynamic";

/**
 * Team link (/t/CODE, REFERRAL_DESIGN.md §9): sends the visitor to the home page with the team
 * leader as the inviter, so the usual first-subscription binding puts them in that team.
 * An unknown code or an API hiccup still lands on the home page, just without an inviter.
 */
export default async function TeamLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = process.env.API_URL ?? "http://localhost:4000";
  let leader: string | null = null;
  try {
    const r = await fetch(`${base}/api/v1/teams/${encodeURIComponent(code)}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (r.ok) {
      const body = (await r.json()) as { leader?: unknown };
      if (typeof body.leader === "string" && isAddress(body.leader)) leader = getAddress(body.leader);
    }
  } catch {
    // fall through to the home page
  }
  redirect(leader ? `/?ref=${leader}` : "/");
}
