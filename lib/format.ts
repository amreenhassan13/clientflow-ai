// Client-safe display helpers.
const currency = process.env.NEXT_PUBLIC_CURRENCY || "AUD";
const locale = process.env.NEXT_PUBLIC_LOCALE || "en-AU";

export function money(value: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(value || 0);
}

export function percent(ratio: number): string {
  return `${Math.round((ratio || 0) * 100)}%`;
}

export function shortDate(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Change versus the previous period, or null when there is nothing to compare against. */
export function delta(current: number, previous: number): { label: string; up: boolean } | null {
  if (!previous) return null;
  const change = (current - previous) / previous;
  return { label: `${Math.abs(Math.round(change * 1000) / 10)}%`, up: change >= 0 };
}

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  synced: "Synced",
  failed: "Failed",
  not_configured: "Not configured",
  no_consent: "No consent",
  disabled: "SMS off",
  invalid_phone: "Invalid phone",
  opted_out: "Opted out",
  accepted: "Accepted",
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  undelivered: "Undelivered",
  canceled: "Canceled",
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  organic: "Organic search",
  referral: "Referral",
  wordpress: "WordPress site",
  social: "Social",
  website: "Website",
};

export function sourceLabel(value: string): string {
  return SOURCE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
