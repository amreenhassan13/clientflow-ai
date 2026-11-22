const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string | null | undefined): value is string {
  return typeof value === "string" && E164.test(value);
}

/**
 * Normalises common international formats ("+61 400 000 000", "0061-400...")
 * to E.164. Numbers that cannot be normalised are kept as typed so staff can
 * still see them; SMS is simply skipped for those leads.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  let compact = trimmed.replace(/[\s().-]/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  return E164.test(compact) ? compact : trimmed;
}
