/** Format a nullable ISO timestamp as a locale string, or an em dash when null. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString()
}
