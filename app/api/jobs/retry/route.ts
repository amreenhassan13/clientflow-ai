import { after } from "next/server";
import { getSession, sameOrigin } from "@/lib/auth";
import { isDemo } from "@/lib/env";
import { json, publicError } from "@/lib/security";
import { processJobs, retryFailedJobs } from "@/lib/worker";

export async function POST(request: Request) {
  if (isDemo()) return json({ error: "Demo mode is read-only." }, 403);
  if (!sameOrigin(request) || !(await getSession())) return json({ error: "Unauthorized" }, 401);
  try {
    const requeued = await retryFailedJobs();
    if (requeued) {
      after(() => processJobs({ timeBudgetMs: 25_000 }).catch((err) => console.error(err)));
    }
    return json({ ok: true, requeued });
  } catch (err) {
    return publicError(err);
  }
}
