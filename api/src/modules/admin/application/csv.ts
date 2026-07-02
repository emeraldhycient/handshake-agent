/**
 * Pure, dependency-free RFC 4180 CSV builder for admin exports (Phase 8).
 *
 * Takes a header row and a matrix of rows and returns a single CSV string.
 * Fields are escaped per RFC 4180: a field is wrapped in double-quotes when it
 * contains a comma, a double-quote, a CR, or an LF; embedded double-quotes are
 * doubled. Records are terminated with CRLF (the RFC line break) — the header
 * counts as the first record. `null`/`undefined` cells render as an empty field
 * (never the literal string "null"). This function moves no data through the
 * database and has no framework dependency; it lives in `application` because it
 * is a pure use-case helper.
 */

/** A single CSV cell before escaping. */
export type CsvCell = string | number | boolean | null | undefined;

const RECORD_SEPARATOR = '\r\n';

/** Characters that force a field to be quoted per RFC 4180. */
function needsQuoting(field: string): boolean {
  return (
    field.includes(',') ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r')
  );
}

/** Escape one cell to its RFC 4180 field form. */
function escapeField(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  const field = String(cell);
  if (!needsQuoting(field)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

/** Join one record's cells, escaping each. */
function toRecord(cells: readonly CsvCell[]): string {
  return cells.map(escapeField).join(',');
}

/**
 * Build an RFC 4180 CSV string from a header and its data rows. Every record —
 * header included — is terminated with CRLF, so an export with no data rows is
 * just the header line plus its terminator.
 */
export function buildCsv(
  header: readonly CsvCell[],
  rows: readonly (readonly CsvCell[])[],
): string {
  const records = [toRecord(header), ...rows.map(toRecord)];
  return records.map((r) => r + RECORD_SEPARATOR).join('');
}
