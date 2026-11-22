// Edge-safe session helpers (used by middleware and by server routes).
import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

export const SESSION_COOKIE = "clientflow_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

function signingKey(secret: string | undefined): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(email: string, secret: string | undefined): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(signingKey(secret));
}

export async function verifySession(
  token: string | undefined,
  secret: string | undefined,
  adminEmail: string | undefined,
): Promise<{ email: string } | null> {
  if (!token || !adminEmail) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(secret), { algorithms: ["HS256"] });
    if (payload.role !== "admin" || payload.sub?.toLowerCase() !== adminEmail.toLowerCase()) {
      return null;
    }
    return { email: payload.sub };
  } catch {
    return null;
  }
}
