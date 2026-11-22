import "server-only";
import { cookies } from "next/headers";
import { scryptSync, timingSafeEqual } from "node:crypto";
import { appUrl } from "./env";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "./session-token";

export function validPassword(password: string): boolean {
  const [salt, expected] = process.env.ADMIN_PASSWORD_HASH?.split(":") ?? [];
  if (!salt || !expected || !password) return false;
  const actual = scryptSync(password, salt, 64);
  const stored = Buffer.from(expected, "hex");
  return actual.length === stored.length && timingSafeEqual(actual, stored);
}

export function validAdminEmail(email: string): boolean {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(admin) && email.trim().toLowerCase() === admin;
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, process.env.AUTH_SECRET, process.env.ADMIN_EMAIL);
}

export async function startSession(email: string): Promise<void> {
  const token = await signSession(email, process.env.AUTH_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * CSRF defence for cookie-authenticated and public browser writes: the Origin
 * header must match this deployment (request host or APP_URL).
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const allowed = new Set([new URL(request.url).origin]);
    const configured = appUrl();
    if (configured) allowed.add(new URL(configured).origin);
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}
