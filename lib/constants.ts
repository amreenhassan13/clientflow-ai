export const SERVICES = [
  "Residential cleaning",
  "Commercial cleaning",
  "Deep cleaning",
  "Move-out cleaning",
  "Other",
] as const;

export const STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;

export type Service = (typeof SERVICES)[number];
export type LeadStatus = (typeof STATUSES)[number];
