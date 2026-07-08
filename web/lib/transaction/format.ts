import { DISPLAY_LOCALE } from "@/lib/format"
import type { StatusTone } from "@/lib/schemas"

/** Status → pill tone. Terminal failures are danger-red (never neutral). */
export function toneFor(status: string): StatusTone {
  if (status === "completed") return "success"
  if (status === "failed" || status === "rolled_back") return "danger"
  return "warn"
}

const TYPE_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  send: "Send",
  deposit: "Deposit",
  receive: "Receive",
  swap: "Swap",
  ticket_purchase: "Ticket",
  reward: "Reward",
  refund: "Refund",
}

/** Human label for a transaction type (falls back to Title-cased type). */
export function labelFor(type: string): string {
  return TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

/** Title-case a snake_case token, e.g. "rolled_back" → "Rolled back". */
export const titleCase = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")

/** Truncate a long hash to head…tail. */
export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash
}

/** Truncate a long chain address to head…tail. */
export function shortAddress(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr
}

/** Format an ISO timestamp as "3 Jul 2026, 9:40 am" (DISPLAY_LOCALE). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}
