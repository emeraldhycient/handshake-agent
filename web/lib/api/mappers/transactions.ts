import type {
  TransactionListResponse,
  TransactionListItem,
} from "@handshake-agent/contracts"
import { DISPLAY_LOCALE } from "@/lib/format"
import { formatCryptoAmount, formatFiatAmount } from "@/lib/format/money"
import type { ActivityGroup, ActivityItem, StatusTone } from "@/lib/schemas"

/** Fiat code → display symbol, sourced from the `/config` fiats by the caller
 *  (never hardcoded here — multi-currency aware, root §13). */
export type FiatSymbols = Record<string, string>

// Per-viewer direction now comes from the API's per-row `direction` (both the
// sender row `out` and the recipient row `in` for an internal transfer). This
// type map is only the FALLBACK when a row carries no `direction` — keeping
// `internal_transfer` here makes a legacy/handle-less row default to the
// sender-side outflow. Don't rely on it for the recipient case.
const OUT_TYPES = new Set(["sell", "send", "internal_transfer"])
const IN_TYPES = new Set([
  "buy",
  "receive",
  "deposit",
  "reward",
  "refund",
  "swap",
])

type Dir = ActivityItem["dir"]

function dirFor(type: string): Dir {
  if (type === "ticket_purchase") return "ticket"
  if (OUT_TYPES.has(type)) return "out"
  // IN_TYPES is the explicit inflow set; any unclassified type also defaults to
  // an inflow (the safe display fallback for a new read-only type).
  return IN_TYPES.has(type) ? "in" : "in"
}

// Icon/colour are display data (hex permitted in lib/, root §4.2).
const DIR_STYLE: Record<Dir, { icon: string; tint: string; col: string }> = {
  in: { icon: "+", tint: "#e6f3ec", col: "#1f8a5b" },
  out: { icon: "↗", tint: "#fbeece", col: "#9a6a12" },
  ticket: { icon: "◇", tint: "#eef0fb", col: "#3b5bb5" },
}

const TITLE: Record<string, (asset?: string) => string> = {
  buy: (a) => `Bought ${a ?? "crypto"}`,
  sell: (a) => `Sold ${a ?? "crypto"}`,
  send: (a) => `Sent ${a ?? "crypto"}`,
  receive: (a) => `Received ${a ?? "crypto"}`,
  deposit: (a) => `Deposit ${a ?? ""}`.trim(),
  ticket_purchase: () => "Ticket",
}

const titleCase = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")

/**
 * Row title. An internal (PayID) transfer is direction-aware — the recipient row
 * reads "Received", the sender row "Sent" — since both share the
 * `internal_transfer` type. Everything else keys off the type map.
 */
function titleFor(type: string, asset: string | undefined, dir: Dir): string {
  if (type === "internal_transfer")
    return dir === "in"
      ? `Received ${asset ?? "crypto"}`
      : `Sent ${asset ?? "crypto"}`
  const fn = TITLE[type]
  return fn ? fn(asset) : titleCase(type)
}

// Terminal-failure statuses get the distinct `danger` tone so a failed/refunded
// transaction never looks like one still in flight (audit #24). The backend
// status is a free-form string, so match the known terminal-failure values;
// everything else in-flight (pending / settling) stays `warn`.
const FAILURE_STATUSES = new Set(["failed", "refunded", "reversed"])

function toneFor(status: string): StatusTone {
  if (status === "completed") return "success"
  if (FAILURE_STATUSES.has(status.toLowerCase())) return "danger"
  return "warn"
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function groupLabel(d: Date, now: Date): string {
  if (sameDay(d, now)) return "Today"
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return "Yesterday"
  return d.toLocaleDateString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
  })
}

function timeLabel(d: Date): string {
  return d
    .toLocaleTimeString(DISPLAY_LOCALE, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(" ", "")
}

function amountFor(
  it: TransactionListItem,
  sign: string,
  fiatSymbols: FiatSymbols
): string {
  if (it.cryptoAmount && it.asset)
    return `${sign}${formatCryptoAmount(it.cryptoAmount, it.asset)}`
  if (it.fiatAmount && it.fiatCurrency)
    return `${sign}${formatFiatAmount(it.fiatAmount, fiatSymbols[it.fiatCurrency] ?? "")}`
  return ""
}

function subFor(
  it: TransactionListItem,
  d: Date,
  dir: Dir,
  fiatSymbols: FiatSymbols
): string {
  const parts = [timeLabel(d)]
  if (it.counterparty) {
    // An inflow arrives "from" its counterparty; an outflow goes "to" it.
    const prep = dir === "in" ? "from" : "to"
    parts.push(
      `${prep} ${it.counterparty.slice(0, 4)}…${it.counterparty.slice(-4)}`
    )
  } else if (it.fiatAmount && it.fiatCurrency)
    parts.push(
      formatFiatAmount(it.fiatAmount, fiatSymbols[it.fiatCurrency] ?? "")
    )
  return parts.join(" · ")
}

export function mapTransactions(
  res: TransactionListResponse,
  now: Date = new Date(),
  fiatSymbols: FiatSymbols = {}
): ActivityGroup[] {
  const groups: ActivityGroup[] = []
  const byLabel = new Map<string, ActivityItem[]>()
  for (const it of res.items) {
    const d = new Date(it.createdAt)
    // Prefer the API's per-viewer direction (internal transfers carry it per
    // row); fall back to the type map for legacy/other rows.
    const dir = it.direction ?? dirFor(it.type)
    const style = DIR_STYLE[dir]
    const sign = dir === "in" ? "+" : "-"
    const item: ActivityItem = {
      id: it.id,
      dir,
      icon: style.icon,
      tint: style.tint,
      col: style.col,
      title: titleFor(it.type, it.asset, dir),
      sub: subFor(it, d, dir, fiatSymbols),
      amount: amountFor(it, sign, fiatSymbols),
      status: titleCase(it.status),
      statusTone: toneFor(it.status),
    }
    const label = groupLabel(d, now)
    let bucket = byLabel.get(label)
    if (!bucket) {
      bucket = []
      byLabel.set(label, bucket)
      groups.push({ group: label, items: bucket })
    }
    bucket.push(item)
  }
  return groups
}
