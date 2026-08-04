import { formatCrypto, formatFiat } from "@/lib/format"
import type {
  AdminTxnListItem,
  AdminTxnSearchQuery,
} from "@handshake-agent/contracts"
import { EM_DASH, PAGE_SIZE, VIEW_STATUS } from "@/constants/transactions"
import type { TransactionsView } from "@/types"

/** Start-of-today ISO string — the "Failed today" view's lower bound (`from`). */
export function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Build the engine search query from the active view + q + cursor. */
export function buildQuery(
  view: TransactionsView,
  q: string,
  cursor: string | undefined
): AdminTxnSearchQuery {
  const trimmed = q.trim()
  return {
    status: VIEW_STATUS[view],
    from: view === "failed" ? startOfTodayIso() : undefined,
    ...(trimmed ? { q: trimmed } : {}),
    cursor,
    limit: PAGE_SIZE,
  }
}

/**
 * A human display name derived from the user's login email local-part (the User
 * model has no name field, §3.4) — "amara.okeke@x.com" → "Amara Okeke". Falls
 * back to a short userId slice when no email is joined.
 */
export function displayName(email: string | null, userId: string): string {
  if (!email) return userId.slice(0, 8)
  const local = email.split("@")[0] ?? ""
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
  return words.length > 0 ? words.join(" ") : userId.slice(0, 8)
}

/**
 * The amount cell: the crypto leg (amount + asset) with the fiat leg beneath.
 * Missing legs collapse gracefully to an em dash.
 */
export function amountLines(t: AdminTxnListItem): {
  crypto: string
  fiat: string
} {
  const crypto =
    t.amount && t.asset
      ? formatCrypto(t.amount, t.asset)
      : t.amount
        ? t.amount
        : EM_DASH
  const fiat =
    t.fiatAmount && t.fiatCurrency
      ? formatFiat(t.fiatAmount, t.fiatCurrency)
      : t.fiatAmount
        ? t.fiatAmount
        : ""
  return { crypto, fiat }
}

/** Compact "Jul 1 · 09:42" created stamp from an ISO timestamp. */
export function formatCreated(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date} · ${time}`
}
