import { isDemo } from "@/lib/env";
import { json, publicError } from "@/lib/security";
import { safeEqual } from "@/lib/signing";
import { exportToBigQuery, housekeeping, processJobs } from "@/lib/worker";

export const maxDuration = 60;

/**
 * Scheduled sweep (vercel.json). New leads are processed immediately at
 * intake; this run handles retries, delayed survey SMS and BigQuery exports.
 * Vercel sends "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) return json({ error: "Unauthorized" }, 401);
  if (isDemo()) return json({ demo: true, message: "Nothing to process in demo mode." });

  try {
    await housekeeping();
    const jobs = await processJobs({ timeBudgetMs: 38_000 });
    let analytics;
    try {
      analytics = await exportToBigQuery({ timeBudgetMs: 15_000 });
    } catch (err) {
      console.error("BigQuery export failed", err);
      analytics = { status: "failed", error: err instanceof Error ? err.message.slice(0, 200) : "unknown" };
    }
    return json({ jobs, analytics });
  } catch (err) {
    return publicError(err);
  }
}
