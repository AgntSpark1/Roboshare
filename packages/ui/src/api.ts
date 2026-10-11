/** Thin client for the RoboShare API (`/api/v1`). Both sites proxy `/api/v1/*` to the API, so cookies stay first-party. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface PreparedTx {
  chainId: number;
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0";
  description: string;
}

/** A governance action for the 2/3 Safe. There is no timelock: it takes effect as soon as two owners sign and execute. */
export interface SafeProposal {
  safe: `0x${string}`;
  /** Each call, to add one by one in the Safe{Wallet} Transaction Builder. */
  calls: { to: `0x${string}`; data: `0x${string}`; description: string }[];
  /** The same as a single Safe transaction (operation 1 = DELEGATECALL to MultiSendCallOnly for a batch). */
  tx: PreparedTx & { operation: 0 | 1 };
}

let base = "/api/v1";
/** Tests point the client at a fake origin. */
export function setApiBase(url: string) {
  base = url;
}

async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    credentials: "include",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? "HTTP_ERROR", e.message ?? `request failed (${res.status})`, e.details);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  post: <T>(path: string, body: unknown = {}, opts: { idempotencyKey?: string } = {}) =>
    call<T>("POST", path, body, opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
};

// ------------------------------------------------------------------ response shapes used by both sites

export interface OfferingSummary {
  status: string;
  unitsSold: number;
  minUnits: number;
  maxUnits: number;
  unitPrice: string;
  endAt: string;
  startAt?: string;
  perWalletMax?: number;
  termsHash?: string;
}

export interface ProjectListItem {
  id: `0x${string}`;
  title: string | null;
  slug: string | null;
  make: string | null;
  model: string | null;
  state: string;
  issuedUnits: number;
  authorizedUnits: number;
  offering: OfferingSummary | null;
}

export interface ProjectDetail extends Omit<ProjectListItem, "title" | "slug" | "make" | "model"> {
  assetId: string;
  rightsDocHash: string;
  meta: { title: string; slug: string; make: string | null; model: string | null; modelYear: number | null; summary: string | null } | null;
  contracts: { token: `0x${string}` | null; offering: `0x${string}` | null; distributor: `0x${string}` | null };
  fundedAtBlock: string | null;
  feeTiers: { minUnits: number; bps: number }[];
  stateHistory: { from: string | null; to: string; chain: { txHash: string; blockNumber: string } }[];
}

export interface ContractsResponse {
  chainId: number;
  items: { kind: string; address: `0x${string}`; projectId: string | null; deployedBlock: string }[];
}

export function contractOf(c: ContractsResponse | undefined, kind: string) {
  return c?.items.find((i) => i.kind === kind && !i.projectId)?.address;
}
