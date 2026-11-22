import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session-token";

/** Server-side protection for admin pages (API routes check the session themselves). */
export async function middleware(request: NextRequest) {
  if (process.env.DEMO_MODE === "true") return NextResponse.next();
  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.AUTH_SECRET,
    process.env.ADMIN_EMAIL,
  );
  if (session) return NextResponse.next();
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/", "/leads", "/settings"] };
