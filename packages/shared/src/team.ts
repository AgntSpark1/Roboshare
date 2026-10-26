/**
 * Promotion teams (REFERRAL_DESIGN.md §9). A team is a leader wallet plus a short code for its link.
 * Membership is not stored: it follows the on-chain referral bindings. A wallet belongs to the team
 * of the nearest leader up its referrer chain (itself included). Bindings are permanent and first-touch,
 * so a wallet never changes team once it has one. Teams change nothing about who is paid or how much.
 */

/** Team codes appear in links (/t/CODE): 2–16 letters or digits, stored upper case. */
export const TEAM_CODE = /^[A-Z0-9]{2,16}$/;

export function normalizeTeamCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return TEAM_CODE.test(code) ? code : null;
}

export interface TeamPlacement {
  /** Lower-case leader wallet of the team. */
  leader: string;
  /** Generations below the leader: 0 = the leader, 1 = invited by the leader, and so on. */
  depth: number;
}

/**
 * Places every wallet that has a team. `referrerOf` maps lower-case referee → referrer;
 * `leaders` holds lower-case leader wallets. Wallets with no leader above them are left out.
 */
export function placeInTeams(referrerOf: ReadonlyMap<string, string>, leaders: ReadonlySet<string>): Map<string, TeamPlacement> {
  const placed = new Map<string, TeamPlacement | null>();
  const resolve = (wallet: string): TeamPlacement | null => {
    if (placed.has(wallet)) return placed.get(wallet)!;
    // Walk up until a leader or a wallet already resolved; the contract makes cycles impossible,
    // but the seen set keeps a bad projection from looping forever.
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = wallet;
    let found: TeamPlacement | null = null;
    while (cur !== undefined && !seen.has(cur)) {
      if (placed.has(cur)) {
        found = placed.get(cur)!;
        break;
      }
      seen.add(cur);
      if (leaders.has(cur)) {
        found = { leader: cur, depth: 0 };
        placed.set(cur, found);
        break;
      }
      path.push(cur);
      cur = referrerOf.get(cur);
    }
    for (let i = path.length - 1; i >= 0; i--) {
      const at = found ? { leader: found.leader, depth: found.depth + (path.length - i) } : null;
      placed.set(path[i]!, at);
    }
    return placed.get(wallet) ?? null;
  };
  for (const w of leaders) resolve(w);
  for (const w of referrerOf.keys()) resolve(w);
  const out = new Map<string, TeamPlacement>();
  for (const [w, p] of placed) if (p) out.set(w, p);
  return out;
}
