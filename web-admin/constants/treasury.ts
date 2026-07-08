/**
 * Treasury constants (design §6.13). The custodial-hero gradient (the only permitted
 * non-token colour, §7) + the per-status dot / label token maps. Colour is never the
 * sole signal — each dot is paired with a note that carries the same meaning.
 */
import type {
  TreasuryExposure,
  TreasurySweep,
} from "@handshake-agent/contracts"
import type { TreasuryCard, TreasurySweepRow } from "@/types/components"

// The custodial hero tile is a dark-green gradient identical in both themes (§5 KPI hero).
export const HERO_GRADIENT =
  "linear-gradient(150deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

// A balance-card health dot's semantic → its token utility.
export const DOT_CLASS: Record<TreasuryCard["dot"], string> = {
  ok: "bg-tok",
  warn: "bg-twn",
  danger: "bg-tdn",
}

// A contract sweep status → the design's row label.
export const SWEEP_LABEL: Record<
  TreasurySweep["status"],
  TreasurySweepRow["status"]
> = {
  swept: "Swept",
  pending: "Pending",
  below_threshold: "Below threshold",
}

// A sweep status → its dot + label token utilities (design per-row `s.dot` / `s.fg`).
export const SWEEP_STATUS: Record<
  TreasurySweepRow["status"],
  { dot: string; fg: string }
> = {
  Swept: { dot: "bg-tok", fg: "text-tok" },
  Pending: { dot: "bg-twn", fg: "text-twn" },
  "Below threshold": { dot: "bg-ink3", fg: "text-ink3" },
}

// Exposure status → the headroom tile's health dot.
export const EXPOSURE_DOT: Record<
  TreasuryExposure["status"],
  TreasuryCard["dot"]
> = {
  safe: "ok",
  warning: "warn",
  critical: "danger",
}
