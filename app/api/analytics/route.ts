import { parsePeriod } from "@/lib/analytics";
import { getSession } from "@/lib/auth";
import { demoAnalytics } from "@/lib/demo";
import { isDemo } from "@/lib/env";
import { liveAnalytics } from "@/lib/leads";
import { json, publicError } from "@/lib/security";

export async function GET(request: Request) {
  const days = parsePeriod(new URL(request.url).searchParams.get("days"));
  if (isDemo()) return json(demoAnalytics(days));
  if (!(await getSession())) return json({ error: "Unauthorized" }, 401);
  try {
    return json(await liveAnalytics(days));
  } catch (err) {
    return publicError(err);
  }
}
