/** Truncate a long provider event id for the table cell (full value in the drawer). */
export function truncateId(id: string): string {
  return id.length > 24 ? `${id.slice(0, 24)}…` : id
}

/** Format a nullable ISO timestamp as a locale string, or an em dash when null. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}

/** Pretty-print an unknown JSON-ish value for the drawer's <pre> blocks. */
export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
