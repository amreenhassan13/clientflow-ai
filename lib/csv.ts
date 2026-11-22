/**
 * Escapes one CSV cell. Values starting with = + - @ tab or CR are prefixed
 * with an apostrophe so spreadsheet apps don't run them as formulas
 * (OWASP CSV injection guidance).
 */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
