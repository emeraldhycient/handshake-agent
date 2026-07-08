/**
 * Reconciliation constants (design §6.12 `Recon.html`). Severity/kind display maps
 * + the manual-trigger job id. Colour is never the sole signal — the uppercase
 * severity label and the kind label carry the state.
 */
import type { ReconBreakKind } from "@handshake-agent/contracts"
import type { ReconBreakSeverity } from "@/types/components"

// The reconciler IS the manual-trigger ops job — "Run now" fires this declared job.
export const RECONCILIATION_JOB_ID = "settlement-reconciliation"

// Severity → the design's pill (10px/800 uppercase). high = danger, medium = warn,
// low = info (§5 canonical status token pairs).
export const SEVERITY_META: Record<
  ReconBreakSeverity,
  { label: string; bg: string; fg: string }
> = {
  high: { label: "High", bg: "bg-sdn", fg: "text-tdn" },
  medium: { label: "Medium", bg: "bg-swn", fg: "text-twn" },
  low: { label: "Low", bg: "bg-sif", fg: "text-tif" },
}

// Per-kind display metadata: a human label + a tinted 36px icon tile + a stroke path.
// Keyed by the contract's snake_case ReconBreakKind.
export const KIND_META: Record<
  ReconBreakKind,
  { label: string; path: string; tile: string; fg: string }
> = {
  // Over-credit — a triangle warning (ledger credited more than the provider).
  over_credit: {
    label: "Over-credit",
    path: "M12 8v5M12 16h.01M12 3l9 16H3z",
    tile: "bg-sdn",
    fg: "text-tdn",
  },
  // Missing settlement — a clock (provider confirmed, ledger not yet posted).
  missing_settlement: {
    label: "Missing settlement",
    path: "M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Amount mismatch — opposing arrows (provider and ledger amounts diverge).
  amount_mismatch: {
    label: "Amount mismatch",
    path: "M7 7h10M7 7l3-3M7 7l3 3M17 17H7m10 0-3 3m3-3-3-3",
    tile: "bg-swn",
    fg: "text-twn",
  },
  // Duplicate credit — stacked squares (the same credit landed twice).
  duplicate_credit: {
    label: "Duplicate credit",
    path: "M9 9h10v10H9zM5 5h10v2M5 5v10h2",
    tile: "bg-sif",
    fg: "text-tif",
  },
}

// Open-card border echoes the design's tinted border on open breaks.
export const OPEN_CARD_LINE: Record<ReconBreakSeverity, string> = {
  high: "border-sdn",
  medium: "border-swn",
  low: "border-sif",
}
