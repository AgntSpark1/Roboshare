/**
 * Referral rewards (REFERRAL_DESIGN.md §10): three levels, paid from the platform fee only.
 * Mirrors the leaf layout ReferralRewards.sol verifies with OpenZeppelin MerkleProof.
 */
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { BPS_DENOMINATOR } from "./fees.js";

/** Default binding window; the binding event carries the window actually in force for each referee. */
export const REFERRAL_DEFAULT_WINDOW_SECONDS = 365 * 24 * 60 * 60;
/**
 * Share of the referee's gross distribution (before the platform share) each level earns: the direct
 * referrer 10%, their referrer 5%, the one above 3%. Nobody further up earns anything. Set in code, like
 * the Merkle root; the shareBps recorded in ReferralBound is not used for the amount.
 */
export const REFERRAL_LEVEL_BPS: readonly number[] = [1_000, 500, 300];
/** What the router is told as shareBps when governance switches referrals on (recorded only). */
export const REFERRAL_DEFAULT_SHARE_BPS = REFERRAL_LEVEL_BPS[0]!;

/** floor(amount * shareBps / 10000). Never more than the amount. */
export function referralReward(amount: bigint, shareBps: number): bigint {
  if (amount < 0n) throw new RangeError("amount must be non-negative");
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > 10_000) throw new RangeError("shareBps out of range");
  return (amount * BigInt(shareBps)) / BPS_DENOMINATOR;
}

/**
 * Rewards for levels 1..3 on one allocation: floor(gross * bps / 10000) each, paid from the platform fee
 * and never more than that fee in total (earlier levels first). Holders' net is never touched.
 */
export function referralRewards(gross: bigint, fee: bigint): bigint[] {
  if (gross < 0n || fee < 0n) throw new RangeError("amounts must be non-negative");
  let left = fee;
  return REFERRAL_LEVEL_BPS.map((bps) => {
    const r = referralReward(gross, bps);
    const paid = r < left ? r : left;
    left -= paid;
    return paid;
  });
}

/** keccak256(bytes.concat(keccak256(abi.encode(account, cumulative)))) */
export function referralLeaf(account: Address, cumulative: bigint): Hex {
  const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [account, cumulative]));
  return keccak256(inner);
}

/** OpenZeppelin Hashes.commutativeKeccak256: hash of the two nodes in ascending order. */
function hashPair(a: Hex, b: Hex): Hex {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return keccak256(`0x${x.slice(2)}${y.slice(2)}`);
}

export interface ReferralEntry {
  account: Address;
  cumulative: bigint;
}

export interface ReferralTree {
  root: Hex;
  totalCumulative: bigint;
  entries: (ReferralEntry & { leaf: Hex; proof: Hex[] })[];
}

/**
 * Builds the tree over every referrer's cumulative reward. Leaves are sorted by hash so the root
 * is independent of input order; an unpaired node moves up a level unhashed (MerkleProof-compatible).
 */
export function buildReferralTree(input: readonly ReferralEntry[]): ReferralTree {
  if (input.length === 0) throw new RangeError("no entries");
  const seen = new Set<string>();
  const entries = input.map((e) => {
    const account = getAddress(e.account);
    if (seen.has(account)) throw new RangeError(`duplicate account ${account}`);
    seen.add(account);
    if (e.cumulative <= 0n) throw new RangeError("cumulative must be positive");
    return { account, cumulative: e.cumulative, leaf: referralLeaf(account, e.cumulative), proof: [] as Hex[] };
  });
  entries.sort((a, b) => (BigInt(a.leaf) < BigInt(b.leaf) ? -1 : 1));

  // positions[i] = index of entry i's ancestor in the current layer
  let layer = entries.map((e) => e.leaf);
  let positions = entries.map((_, i) => i);
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(i + 1 < layer.length ? hashPair(layer[i]!, layer[i + 1]!) : layer[i]!);
    positions = positions.map((p, i) => {
      const sibling = p ^ 1;
      if (sibling < layer.length) entries[i]!.proof.push(layer[sibling]!);
      return p >> 1;
    });
    layer = next;
  }
  return { root: layer[0]!, totalCumulative: entries.reduce((s, e) => s + e.cumulative, 0n), entries };
}

/** Same check as MerkleProof.verify, for tests and the API's self-check before serving a proof. */
export function verifyReferralProof(root: Hex, account: Address, cumulative: bigint, proof: readonly Hex[]): boolean {
  return proof.reduce<Hex>((h, p) => hashPair(h, p), referralLeaf(getAddress(account), cumulative)) === root;
}
