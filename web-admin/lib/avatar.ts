/**
 * Two-letter initials from a display name (first + last word, or first two chars
 * of a single word). Falls back to "?" for an empty name. Canonical replacement
 * for the per-file initials helpers (admins-page, user-detail).
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  const single = parts[0] ?? ""
  return (single.slice(0, 2) || "?").toUpperCase()
}
