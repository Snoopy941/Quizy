import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "quizy_session";
const ALG = "HS256";

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(s);
}

export interface SessionPayload {
  userId: string;
  email: string;
  /** User.tokenVersion when issued — bumping it signs out every session. */
  tv?: number;
}

export async function createSessionToken(payload: SessionPayload) {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email, tv: typeof payload.tv === "number" ? payload.tv : 0 };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  // The desktop app is served over plain http (127.0.0.1, or the LAN for phones).
  secure: process.env.NODE_ENV === "production" && process.env.QUIZY_PORTABLE !== "1",
  maxAge: 60 * 60 * 24 * 30, // 30 days
  path: "/",
};
