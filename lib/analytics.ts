import type { LeadStatus } from "./constants";
import { STATUSES } from "./constants";

export const PERIODS = [7, 14, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(value: string | null | undefined): Period {
  const n = Number(value);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 14;
}

export type NamedCount = { name: string; value: number };

export type AnalyticsPayload = {
  demo: boolean;
  periodDays: number;
  timeZone: string;
  generatedAt: string;
  kpis: {
    /** Leads created in the period, and in the period before it. */
    leads: number;
    leadsPrev: number;
    /** Leads currently in the qualified stage (snapshot) and their total estimated value. */
    qualifiedOpen: number;
    qualifiedOpenValue: number;
    /** Estimated value of leads marked won during the period (by won date). */
    wonValue: number;
    wonValuePrev: number;
    wonCount: number;
    /** Share of leads created in the period that are now won (0-1). */
    conversion: number;
    conversionPrev: number;
    /** Share of leads created in the period that are now lost (0-1). */
    lostRatio: number;
    /** Average estimated value of all won leads with a value set. */
    averageDeal: number;
  };
  trend: { day: string; leads: number; qualified: number }[];
  sources: NamedCount[];
  services: NamedCount[];
  pipeline: NamedCount[];
  health: {
    hubspotSynced: number;
    hubspotFailed: number;
    hubspotNotConfigured: number;
    smsSent: number;
    smsDelivered: number;
    smsFailed: number;
    optedOut: number;
  };
  queue: { pending: number; processing: number; done: number; failed: number };
  exports: { pending: number; lastExportAt: string | null };
};

/** Minimal lead shape needed to compute analytics in memory (demo mode and tests). */
export type AnalyticsLead = {
  status: LeadStatus;
  estimated_value: number;
  source: string;
  service: string;
  created_at: string;
  won_at: string | null;
  integration_hubspot: string;
  integration_sms: string;
};

const DAY_MS = 86_400_000;

function utcDayIndex(iso: string): number {
  return Math.floor(new Date(iso).getTime() / DAY_MS);
}

export function dayKey(dayIndex: number): string {
  return new Date(dayIndex * DAY_MS).toISOString().slice(0, 10);
}

function countBy(rows: AnalyticsLead[], key: "source" | "service"): NamedCount[] {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row[key], (map.get(row[key]) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/**
 * In-memory implementation of the same metric definitions that
 * lib/leads.ts computes in SQL. Days are UTC days.
 */
export function computeAnalytics(
  leads: AnalyticsLead[],
  options: {
    days: Period;
    now?: Date;
    queue: AnalyticsPayload["queue"];
    exports: AnalyticsPayload["exports"];
    optedOut: number;
    demo: boolean;
  },
): AnalyticsPayload {
  const now = options.now ?? new Date();
  const today = Math.floor(now.getTime() / DAY_MS);
  const d = options.days;
  const inCurrent = (day: number) => day > today - d && day <= today;
  const inPrevious = (day: number) => day > today - 2 * d && day <= today - d;

  const current = leads.filter((l) => inCurrent(utcDayIndex(l.created_at)));
  const previous = leads.filter((l) => inPrevious(utcDayIndex(l.created_at)));
  const wonCurrent = leads.filter((l) => l.won_at && inCurrent(utcDayIndex(l.won_at)));
  const wonPrevious = leads.filter((l) => l.won_at && inPrevious(utcDayIndex(l.won_at)));
  const wonAll = leads.filter((l) => l.status === "won" && l.estimated_value > 0);
  const qualified = leads.filter((l) => l.status === "qualified");
  const sum = (rows: AnalyticsLead[]) => rows.reduce((t, l) => t + l.estimated_value, 0);
  const share = (rows: AnalyticsLead[], status: LeadStatus) =>
    rows.length ? rows.filter((l) => l.status === status).length / rows.length : 0;

  const trend = [];
  for (let day = today - d + 1; day <= today; day++) {
    const created = current.filter((l) => utcDayIndex(l.created_at) === day);
    trend.push({
      day: dayKey(day),
      leads: created.length,
      qualified: created.filter((l) => l.status === "qualified" || l.status === "won").length,
    });
  }

  return {
    demo: options.demo,
    periodDays: d,
    timeZone: "UTC",
    generatedAt: now.toISOString(),
    kpis: {
      leads: current.length,
      leadsPrev: previous.length,
      qualifiedOpen: qualified.length,
      qualifiedOpenValue: sum(qualified),
      wonValue: sum(wonCurrent),
      wonValuePrev: sum(wonPrevious),
      wonCount: wonCurrent.length,
      conversion: share(current, "won"),
      conversionPrev: share(previous, "won"),
      lostRatio: share(current, "lost"),
      averageDeal: wonAll.length ? sum(wonAll) / wonAll.length : 0,
    },
    trend,
    sources: countBy(current, "source"),
    services: countBy(current, "service"),
    pipeline: STATUSES.map((name) => ({
      name,
      value: leads.filter((l) => l.status === name).length,
    })),
    health: {
      hubspotSynced: leads.filter((l) => l.integration_hubspot === "synced").length,
      hubspotFailed: leads.filter((l) => l.integration_hubspot === "failed").length,
      hubspotNotConfigured: leads.filter((l) => l.integration_hubspot === "not_configured").length,
      smsSent: leads.filter((l) => ["queued", "sent", "delivered", "undelivered", "failed"].includes(l.integration_sms)).length,
      smsDelivered: leads.filter((l) => l.integration_sms === "delivered").length,
      smsFailed: leads.filter((l) => ["undelivered", "failed"].includes(l.integration_sms)).length,
      optedOut: options.optedOut,
    },
    queue: options.queue,
    exports: options.exports,
  };
}
