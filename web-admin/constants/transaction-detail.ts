import type { AdminTxnStatus, ReconBreak } from "@handshake-agent/contracts"

import type {
  StatusPillStatus,
  TxActionButton,
  TxTimelineTone,
} from "@/types/components"

/** Subtle placeholder for a design field the contract does not yet provide. */
export const DASH = "—"

/** The double-entry ledger grid (Account / Dir / Amount / Seq). */
export const LEDGER_GRID = "grid grid-cols-[1.6fr_0.7fr_1fr_0.7fr] gap-2"

/**
 * Fold the engine's `TransactionStatus` onto the canonical StatusPill status.
 * The pill map has no `settling`/`confirmed`/etc. keys, so terminal-good folds to
 * `settled`, in-flight to `pending_settlement`, failures to `failed`, reversals
 * to `refunded`, and the early lifecycle to `initiated`.
 */
export const STATUS_TO_PILL: Record<AdminTxnStatus, StatusPillStatus> = {
  pending: "initiated",
  validating: "quoted",
  confirmed: "quoted",
  settling: "pending_settlement",
  completed: "settled",
  failed: "failed",
  rolled_back: "refunded",
  cancelled: "failed",
}

/** A concise human label per engine status for the pill (design-consistent). */
export const STATUS_LABEL: Record<AdminTxnStatus, string> = {
  pending: "Pending",
  validating: "Validating",
  confirmed: "Confirmed",
  settling: "Pending settlement",
  completed: "Settled",
  failed: "Failed",
  rolled_back: "Rolled back",
  cancelled: "Cancelled",
}

// Human labels for the re-run-recon break kinds (mirrors the recon page's KIND_META,
// label-only — this surface renders a compact result row, not the full break card).
export const RECON_KIND_LABEL: Record<ReconBreak["kind"], string> = {
  over_credit: "Over-credit",
  missing_settlement: "Missing settlement",
  amount_mismatch: "Amount mismatch",
  duplicate_credit: "Duplicate credit",
}

// tone → { dot bg/fg, label fg, icon path } (logic.js done/pend/fail, lines 710-712).
export const TIMELINE_TONE: Record<
  TxTimelineTone,
  { dotBg: string; dotFg: string; fg: string; icon: string }
> = {
  done: {
    dotBg: "bg-[#1f8a5b]",
    dotFg: "text-white",
    fg: "text-ink",
    icon: "m5 12 5 5L20 7",
  },
  pending: {
    dotBg: "bg-swn",
    dotFg: "text-twn",
    fg: "text-twn",
    icon: "M12 7v5l3 2",
  },
  fail: {
    dotBg: "bg-sdn",
    dotFg: "text-tdn",
    fg: "text-tdn",
    icon: "M6 6l12 12M18 6L6 18",
  },
}

// The engine-brokered triage actions (Phase 7 owns their writes — propose-only here).
export const TX_ACTIONS: TxActionButton[] = [
  {
    label: "Retry settlement",
    kind: "retry",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Refund",
    kind: "refund",
    icon: "M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4",
  },
  {
    label: "Mark failed",
    kind: "markFailed",
    icon: "M6 6l12 12M18 6L6 18",
    danger: true,
  },
  { label: "Re-run recon", kind: "recon", icon: "M12 4v16M4 20h16" },
  { label: "Resend receipt", kind: "receipt", icon: "M4 4h16v12H8l-4 4z" },
]

/** Per-provider display label + (for TRON) an external explorer link builder. */
export const PROVIDER_META: Record<
  string,
  { label: string; explorer?: (ref: string) => { link: string; href: string } }
> = {
  tron: {
    label: "TRON",
    explorer: (ref) => ({
      link: "Tronscan",
      href: `https://tronscan.org/#/transaction/${ref}`,
    }),
  },
  flutterwave: { label: "Flutterwave" },
  blockradar: { label: "Blockradar" },
  swap: { label: "Swap" },
}
