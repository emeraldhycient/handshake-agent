import type { TransactionHistoryItem } from "@handshake-agent/contracts"
import type { TransactionRow } from "@/lib/schemas"

/**
 * Maps a server transaction-history item to the chat `TransactionsCard` row shape.
 *
 * Shared by the initial agent-outcome render (`mapOutcomeToMessages`) and the
 * "Show more" load-more fetch so the first page and every subsequent page render
 * identically. Amounts are ALREADY formatted server-side (via the AssetRegistry,
 * multi-currency aware) — the FE only prepends the +/- direction sign.
 */
export function mapHistoryItemToRow(
  it: TransactionHistoryItem
): TransactionRow {
  return {
    id: it.id,
    type: it.type,
    status: it.status,
    direction: it.direction,
    amount: `${it.direction === "in" ? "+" : "-"}${it.cryptoAmount ?? it.fiatAmount ?? ""}`,
    sub: it.createdAt.slice(0, 10),
  }
}
