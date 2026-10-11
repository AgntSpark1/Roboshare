/** Display helpers. Amounts are base-unit strings (USDT has 18 decimals on BNB Chain). */

export const USDT_DECIMALS = 18;

export function toBigInt(v: string | number | bigint | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  // Prisma decimals can serialize as "1e+21"; normalise through the integer part.
  return /e/i.test(v) ? BigInt(Number(v).toLocaleString("fullwide", { useGrouping: false })) : BigInt(v.split(".")[0]!);
}

/** 1234500000000000000000 -> "1,234.50" (2 decimals, rounded down so we never overstate). */
export function formatUsdt(amount: string | number | bigint | null | undefined, decimals = USDT_DECIMALS, places = 2): string {
  const v = toBigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const unit = 10n ** BigInt(decimals);
  const whole = abs / unit;
  const frac = ((abs % unit) * 10n ** BigInt(places)) / unit;
  const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${w}${places > 0 ? "." + frac.toString().padStart(places, "0") : ""}`;
}

/** "1,000.5" -> base units. Throws on malformed input. */
export function parseUsdt(text: string, decimals = USDT_DECIMALS): bigint {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("请输入有效金额");
  const [w, f = ""] = t.split(".");
  if (f.length > decimals) throw new Error(`最多 ${decimals} 位小数`);
  return BigInt(w!) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}

export function shortAddr(a: string | null | undefined, head = 6, tail = 4): string {
  if (!a) return "—";
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : bps % 10 === 0 ? 1 : 2)}%`;
}

export function formatDate(d: string | number | Date | null | undefined): string {
  if (d === null || d === undefined) return "—";
  const date = d instanceof Date ? d : new Date(typeof d === "number" && d < 1e12 ? d * 1000 : d);
  if (Number.isNaN(date.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function countdown(to: string | number | Date, now = Date.now(), days: (d: number) => string = (d) => `${d}天`): string {
  let s = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${days(d)} ` : ""}${p(h)}:${p(m)}:${p(s)}`;
}

/** Chinese labels for on-chain project states (PROJECT_STATES in @roboshare/shared). */
export const STATE_LABEL: Record<string, string> = {
  NONE: "未登记",
  DRAFT: "草稿",
  VERIFIED: "已核验",
  OFFERING: "募集中",
  FUNDED: "已募满",
  ACTIVE: "运营中",
  SUSPENDED: "已暂停",
  EXIT_PENDING: "退出中",
  TERMINATED: "已终止",
  CLOSED: "已关闭",
  CANCELLED: "已取消",
};

export function stateLabel(s: string, labels: Record<string, string> = STATE_LABEL): string {
  return labels[s] ?? s;
}
