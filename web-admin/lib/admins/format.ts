import { ROLE_DOT_PALETTE } from "@/constants/admins"

/** Deterministic role-dot colour from the role name (stable palette index). */
export function roleDot(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return ROLE_DOT_PALETTE[hash % ROLE_DOT_PALETTE.length]
}

/**
 * Compact last-login stamp ("Jul 3, 2026 · 16:23"); "Never" when the admin has not
 * signed in yet (null / unparseable).
 */
export function formatLastLogin(iso: string | null): string {
  if (!iso) return "Never"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "Never"
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date} · ${time}`
}
