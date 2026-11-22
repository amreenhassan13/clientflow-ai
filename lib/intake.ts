import "server-only";
import { after } from "next/server";
import { processJobs } from "./worker";

/**
 * Runs the new lead's HubSpot sync and welcome SMS right after the response
 * is sent (Vercel keeps the function alive via waitUntil). The daily cron is
 * only a safety net for retries, so customers get their SMS within seconds.
 */
export function processLeadSoon(leadId: string): void {
  after(async () => {
    try {
      await processJobs({ leadId, maxJobs: 4, timeBudgetMs: 20_000 });
    } catch (err) {
      console.error("Immediate processing failed; the scheduled worker will retry", err);
    }
  });
}
