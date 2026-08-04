import type {
  AdminLedgerEntry,
  AdminLedgerIntegritySummary,
} from "@handshake-agent/contracts"

import { formatAmount } from "@/lib/format"
import type { LedgerRow } from "@/types"

/**
 * Project entries onto the design's row shape (newest-first, as returned). Each row
 * formats against its OWN currency (this is a mixed-currency global view).
 */
export function toRows(entries: readonly AdminLedgerEntry[]): LedgerRow[] {
  return entries.map((e) => ({
    key: e.id,
    seq: String(e.sequence),
    acct: `${e.accountType}:${e.accountId}:${e.currency}`,
    dir: e.direction.toUpperCase(),
    dirDanger: e.direction === "debit",
    amt: formatAmount(e.amount, e.currency),
    run: formatAmount(e.balanceAfter, e.currency),
    src: e.transactionId,
    href: e.transactionId ? `/transactions/${e.transactionId}` : null,
  }))
}

/**
 * Derive the header integrity pill from the real integrity summary — ok / broken
 * (with the offending account) — degrading to a neutral "checking" label while the
 * summary loads or errors.
 */
export function integrityPill(data: AdminLedgerIntegritySummary | undefined): {
  broken: boolean
  label: string
} {
  const ok = data?.ok === true
  const broken = data?.ok === false
  const label = broken
    ? `Sequence gap: ${data?.brokenAccount ?? "unknown"}`
    : ok
      ? "Sequence integrity OK"
      : "Checking integrity…"
  return { broken, label }
}
