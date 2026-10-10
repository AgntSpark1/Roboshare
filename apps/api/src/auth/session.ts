import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "rs_session";
export const SESSION_TTL_SECONDS = 60 * 60;

export interface Session {
  userId: string;
  wallet: string; // lowercase
  /** Unix seconds until which staff TOTP step-up is valid. */
  stepUpUntil?: number;
}

export const STEP_UP_SECONDS = 15 * 60;

export async function signSession(s: Session, secret: string): Promise<string> {
  return new SignJWT({ wallet: s.wallet, ...(s.stepUpUntil ? { stepUpUntil: s.stepUpUntil } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySession(token: string, secret: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.wallet !== "string") return null;
    const stepUpUntil = typeof payload.stepUpUntil === "number" ? payload.stepUpUntil : undefined;
    return { userId: payload.sub, wallet: payload.wallet, stepUpUntil };
  } catch {
    return null;
  }
}
