import type { AdminTxnDetail } from "@handshake-agent/contracts"

import { ApiError } from "@/lib/api/client"
import { formatAmount, formatCrypto } from "@/lib/format"
import { PROVIDER_META } from "@/constants/transaction-detail"
import type {
  EngineLedgerRow,
  TxFlowKind,
  TxFlowSpec,
  TxRefRow,
  TxTimelineTone,
} from "@/types/components"

/** Format an ISO timestamp for the timeline / created displays. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString()
}

/**
 * The header title: "{type} · {amount} {asset}" when the economics carry an
 * amount (design's `{type} · {amount} USDT`), else just the type.
 */
export function headerTitle(tx: AdminTxnDetail): string {
  const { amount, asset } = tx.economics
  if (amount && asset) return `${tx.type} · ${formatCrypto(amount, asset)}`
  if (amount) return `${tx.type} · ${amount}`
  return tx.type
}

/** Map an engine timeline entry's status onto a stepper tone. */
export function timelineTone(status: string): TxTimelineTone {
  if (status === "failed" || status === "cancelled" || status === "rolled_back")
    return "fail"
  if (status === "completed" || status === "confirmed") return "done"
  return "pending"
}

/**
 * Build the flow spec for a triage action from the REAL transaction detail. Each
 * chain's terminal step is the one wired to the mutation: `engine` for the
 * engine-brokered retry/mark-failed, `maker` for the four-eyes refund request.
 * Pure — it only describes the proposal; the engine still disposes (§3.1).
 */
export function flowSpecFor(
  kind: TxFlowKind,
  tx: AdminTxnDetail
): TxFlowSpec | null {
  const engineLedger: EngineLedgerRow[] = tx.ledgerLegs.map((l) => ({
    acct: `${l.accountType}:${l.accountId}:${l.currency}`,
    dir: l.direction === "debit" ? "DR" : "CR",
    amt: formatAmount(l.amount, l.currency),
  }))

  switch (kind) {
    case "retry":
      return {
        steps: ["engine"],
        title: "Retry settlement",
        cta: "Execute retry via engine",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Directive", v: "settlement.retry" },
          { k: "Type", v: tx.type },
        ],
        // Retry re-enqueues settlement — it writes no ledger legs itself (§3.1).
        ledger: [],
      }
    case "refund":
      return {
        steps: ["reason", "maker"],
        title: "Refund",
        cta: "Submit for approval",
        diff: [
          {
            field: `Refund · ${tx.id}`,
            from: "Settling",
            to: "Failed + refunded",
          },
        ],
        effect: [
          { k: "Original tx", v: tx.id },
          { k: "User", v: tx.userId },
        ],
        ledger: engineLedger,
      }
    case "markFailed":
      return {
        steps: ["reason", "engine"],
        title: "Mark failed",
        cta: "Mark failed via engine",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Directive", v: "mark_failed" },
        ],
        ledger: engineLedger,
      }
    case "recon":
      // Read-only provider-vs-ledger detection (not a settlement re-drive). No reason
      // step: it moves no money, so it goes straight to a confirm → step-up → run.
      return {
        steps: ["engine"],
        title: "Re-run reconciliation",
        cta: "Run reconciliation",
        effect: [
          { k: "Transaction", v: tx.id },
          { k: "Check", v: "Provider-vs-ledger reconciliation" },
          { k: "Effect", v: "Read-only — detects breaks, moves no money" },
        ],
        // A detection pass posts no ledger legs (§3.1).
        ledger: [],
      }
    case "receipt":
      return null // design: no flow — just a toast
  }
}

/**
 * Provider references from the backend projection (TRON hash + Tronscan link,
 * Flutterwave payout ref, Blockradar withdrawal id, swap id) plus the always-
 * present idempotency key. Unknown providers fall back to a title-cased label.
 */
export function providerRefs(tx: AdminTxnDetail): TxRefRow[] {
  const refs: TxRefRow[] = tx.providerReferences.map((r) => {
    const meta = PROVIDER_META[r.provider]
    const label =
      meta?.label ?? r.provider[0].toUpperCase() + r.provider.slice(1)
    const explorer = meta?.explorer?.(r.reference)
    return {
      label,
      value: r.reference,
      ...(explorer ? { link: explorer.link, href: explorer.href } : {}),
    }
  })
  refs.push({ label: "Idempotency", value: tx.idempotencyKey })
  return refs
}

/** Narrow an unknown triage-action error to its operator-facing message. */
export function txActionError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "The action could not be completed."
}
