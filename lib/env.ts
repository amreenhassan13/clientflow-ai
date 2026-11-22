export function isDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** Public base URL without a trailing slash, e.g. https://crm.example.com */
export function appUrl(): string | null {
  const value = process.env.APP_URL?.trim();
  return value ? value.replace(/\/+$/, "") : null;
}

/** IANA time zone used for daily charts and period boundaries. */
export function businessTimeZone(): string {
  const tz = process.env.BUSINESS_TIMEZONE?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Salt for pseudonymous BigQuery lead references. */
export function analyticsSalt(): string {
  return process.env.ANALYTICS_SALT || process.env.AUTH_SECRET || "clientflow-analytics";
}
