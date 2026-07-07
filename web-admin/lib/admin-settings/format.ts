/** Human-readable expiry label for a session (falls back to the raw string). */
export function expiryLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
