import { Prisma } from "@roboshare/db";

/** Converts Prisma Decimal / bigint / Date values to JSON-safe strings (amounts never become floats). */
export function plain<T>(value: T): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toFixed();
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

export const lc = (a: string) => a.toLowerCase();
