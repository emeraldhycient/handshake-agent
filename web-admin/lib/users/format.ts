import type { AdminEndUserListItem } from "@handshake-agent/contracts"

import { initialsOf } from "@/lib/avatar"
import { AVATAR_HUES, KYC_STATUS_TO_BUCKET } from "@/constants/users"
import type { UsersRow } from "@/types"

/** Stable avatar hue from a user id (no colour field in the list contract). */
export function avatarHue(id: string): string {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 997
  return AVATAR_HUES[sum % AVATAR_HUES.length]
}

/**
 * Relative "last active" label from a nullable ISO timestamp — the contract's real
 * `lastActiveAt` (latest session / device / transaction), not registration time.
 * Null (never active) or an unparseable value renders an em dash.
 */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * Compact balance label from the per-asset aggregate. Shows the primary asset's
 * amount + symbol (e.g. "100.5 USDT"); "+N" when the user holds more assets.
 * Native crypto amounts only — the contract carries no fiat total for the list.
 */
export function balanceLabel(
  balances: AdminEndUserListItem["balances"]
): string {
  const held = balances.filter((b) => Number(b.amount) > 0)
  if (held.length === 0) return "—"
  const [primary, ...rest] = held
  const amount = Number(primary.amount).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
  const base = `${amount} ${primary.asset}`
  return rest.length > 0 ? `${base} +${rest.length}` : base
}

/** Map a list item to its presentation row (design `toRow`). */
export function toRow(item: AdminEndUserListItem): UsersRow {
  const name = item.displayName
  return {
    id: item.id,
    name,
    email: item.email ?? "—",
    initials: initialsOf(name),
    avatar: avatarHue(item.id),
    kyc: KYC_STATUS_TO_BUCKET[item.kycStatus],
    tier: item.kycTier,
    simSwapFlagged: item.simSwapFlagged,
    sanctionsFlagged: item.sanctionsFlagged,
    balance: balanceLabel(item.balances),
    lastActive: relativeTime(item.lastActiveAt),
  }
}
