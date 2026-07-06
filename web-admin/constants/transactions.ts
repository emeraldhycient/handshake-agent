import type {
  AdminTxnStatus,
  AdminTxnViewCounts,
} from "@handshake-agent/contracts"
import type { StatusPillStatus, TransactionsView } from "@/types/components"

/** Type-icon `path` data — logic.js `typeIcon` (vTxns). */
export const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M8 7h11l-3-3M16 17H5l3 3",
  receive: "M12 4v13l-4-4",
  ticket: "M4 9h16v6H4z",
}
/** Neutral fallback glyph for any transaction type the design didn't enumerate. */
export const FALLBACK_ICON = "M6 12h12"

/**
 * The engine's `AdminTxnStatus` → the design's `StatusPill` status + label +
 * stuck (pulsing dot for in-flight states).
 */
export const STATUS_META: Record<
  AdminTxnStatus,
  { status: StatusPillStatus; label: string; stuck: boolean }
> = {
  pending: { status: "pending_settlement", label: "Pending", stuck: true },
  validating: {
    status: "pending_settlement",
    label: "Validating",
    stuck: true,
  },
  confirmed: { status: "pending_settlement", label: "Confirmed", stuck: true },
  settling: { status: "pending_settlement", label: "Settling", stuck: true },
  completed: { status: "settled", label: "Settled", stuck: false },
  failed: { status: "failed", label: "Failed", stuck: false },
  rolled_back: { status: "refunded", label: "Refunded", stuck: false },
  cancelled: { status: "initiated", label: "Cancelled", stuck: false },
}

/** View tabs — logic.js `txViews`. */
export const TX_VIEWS: { id: TransactionsView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stuck", label: "Stuck / Pending" },
  { id: "failed", label: "Failed today" },
  { id: "refunds", label: "Refunds" },
]

/** The single BE `status` filter each view maps onto (the engine takes one status). */
export const VIEW_STATUS: Record<TransactionsView, AdminTxnStatus | undefined> =
  {
    all: undefined,
    stuck: "settling",
    failed: "failed",
    refunds: "rolled_back",
  }

/** The count key each view tab reads from the response's `counts` block. */
export const VIEW_COUNT_KEY: Record<
  TransactionsView,
  keyof AdminTxnViewCounts
> = {
  all: "all",
  stuck: "stuck",
  failed: "failed",
  refunds: "refunds",
}

export const SEARCH_DEBOUNCE_MS = 250
export const PAGE_SIZE = 10
export const MAX_WIDTH = "1360px"
/** The design table grid — logic.js Txns.html. */
export const GRID = "grid-cols-[1.1fr_0.8fr_1.3fr_1.1fr_1fr_1.4fr_0.9fr]"
export const EM_DASH = "—"
