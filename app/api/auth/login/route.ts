import { sameOrigin, startSession, validAdminEmail, validPassword } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { clientIp, handleRouteError, json, rateLimit, readJson } from "@/lib/security";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    if (isDemo()) return json({ error: "Demo mode does not use sign-in. Open the dashboard directly." }, 400);
    if (!sameOrigin(request)) return json({ error: "Invalid origin" }, 403);
    if (!(await rateLimit(`login:${clientIp(request)}`, 8, 900))) {
      return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429);
    }
    const parsed = loginSchema.safeParse(await readJson(request));
    // Check both fields before answering so responses don't reveal which one was wrong.
    if (!parsed.success || !(validPassword(parsed.data.password) && validAdminEmail(parsed.data.email))) {
      return json({ error: "Invalid email or password." }, 401);
    }
    await startSession(parsed.data.email);
    return json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
