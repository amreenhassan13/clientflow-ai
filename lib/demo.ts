// Deterministic, clearly fictional demo data. The dashboard and the leads
// table are computed from the same records, so their numbers always agree.
import { computeAnalytics, type AnalyticsLead, type Period } from "./analytics";
import { SERVICES, type LeadStatus } from "./constants";

export type DemoLead = AnalyticsLead & {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  notes: string;
  sms_consent: boolean;
};

const FIRST = ["Olivia", "Liam", "Ava", "Noah", "Mia", "Ethan", "Isla", "Lucas", "Zara", "Leo", "Chloe", "Harper", "Oscar", "Amelia", "Jack", "Ruby", "Hugo", "Sienna", "Arlo", "Freya"];
const LAST = ["Martin", "Chen", "Patel", "Wilson", "Thompson", "Roberts", "Nguyen", "Kelly", "Singh", "Brown", "Walker", "Hassan", "Lee", "Murphy", "Taylor", "Costa"];
const SOURCES: [string, number][] = [["google", 0.36], ["organic", 0.24], ["referral", 0.16], ["wordpress", 0.14], ["social", 0.1]];
const VALUE_RANGE: Record<string, [number, number]> = {
  "Residential cleaning": [180, 520],
  "Commercial cleaning": [900, 3200],
  "Deep cleaning": [380, 980],
  "Move-out cleaning": [320, 760],
  Other: [150, 600],
};
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 180;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function weighted(rand: () => number, items: [string, number][]): string {
  let r = rand();
  for (const [value, weight] of items) {
    if ((r -= weight) <= 0) return value;
  }
  return items[items.length - 1][0];
}

/** Generates demo leads relative to `now`, so charts always show recent activity. */
export function generateDemoLeads(now: Date = new Date()): DemoLead[] {
  const rand = mulberry32(20261121);
  const today = Math.floor(now.getTime() / DAY_MS);
  const leads: DemoLead[] = [];
  let seq = 0;

  for (let ago = HISTORY_DAYS - 1; ago >= 0; ago--) {
    const day = today - ago;
    const weekday = new Date(day * DAY_MS).getUTCDay();
    const growth = 1 + (HISTORY_DAYS - ago) / HISTORY_DAYS; // business grows over time
    const base = (weekday === 0 || weekday === 6 ? 2.2 : 3.4) * growth;
    const count = Math.max(0, Math.round(base + (rand() - 0.5) * 3));

    for (let i = 0; i < count; i++) {
      seq++;
      const createdMs = day * DAY_MS + Math.floor(rand() * 24 * 3_600_000);
      if (createdMs > now.getTime()) continue;
      const service = weighted(rand, [[SERVICES[0], 0.38], [SERVICES[2], 0.27], [SERVICES[1], 0.17], [SERVICES[3], 0.13], [SERVICES[4], 0.05]]);
      const [lo, hi] = VALUE_RANGE[service];
      const ageDays = ago;
      const roll = rand();
      let status: LeadStatus;
      if (ageDays < 2) status = roll < 0.75 ? "new" : "contacted";
      else if (ageDays < 7) status = roll < 0.2 ? "new" : roll < 0.5 ? "contacted" : roll < 0.8 ? "qualified" : "won";
      else if (ageDays < 21) status = roll < 0.1 ? "contacted" : roll < 0.3 ? "qualified" : roll < 0.7 ? "won" : "lost";
      else status = roll < 0.04 ? "qualified" : roll < 0.6 ? "won" : "lost";

      const hasValue = status !== "new" && status !== "contacted";
      const value = hasValue ? Math.round((lo + rand() * (hi - lo)) / 10) * 10 : 0;
      const wonAt =
        status === "won"
          ? new Date(Math.min(now.getTime(), createdMs + Math.floor(1 + rand() * Math.min(9, Math.max(1, ageDays))) * DAY_MS)).toISOString()
          : null;
      const first = pick(rand, FIRST);
      const last = pick(rand, LAST);
      const consent = rand() < 0.68;
      const smsRoll = rand();
      const recent = ageDays === 0 && rand() < 0.4;

      leads.push({
        id: `00000000-0000-4000-8000-${seq.toString(16).padStart(12, "0")}`,
        full_name: `${first} ${last}`,
        email: `${first}.${last}${seq}@example.com`.toLowerCase(),
        phone: consent ? `+614915${String(70000 + (seq % 9999)).padStart(5, "0")}` : "",
        notes: "",
        sms_consent: consent,
        service,
        source: weighted(rand, SOURCES),
        status,
        estimated_value: value,
        created_at: new Date(createdMs).toISOString(),
        won_at: wonAt,
        integration_hubspot: recent ? "pending" : rand() < 0.985 ? "synced" : "failed",
        integration_sms: !consent ? "no_consent" : recent ? "pending" : smsRoll < 0.93 ? "delivered" : smsRoll < 0.97 ? "undelivered" : "sent",
      });
    }
  }
  return leads.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function demoAnalytics(days: Period, now: Date = new Date()) {
  const leads = generateDemoLeads(now);
  const pendingToday = leads.filter((l) => l.integration_hubspot === "pending").length;
  return computeAnalytics(leads, {
    days,
    now,
    demo: true,
    optedOut: 3,
    queue: { pending: pendingToday * 2, processing: 0, done: leads.length * 2 - pendingToday * 2, failed: 1 },
    exports: {
      pending: pendingToday * 3,
      lastExportAt: new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS).toISOString(),
    },
  });
}
