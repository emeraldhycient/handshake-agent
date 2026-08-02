/**
 * Operator-dashboard constants (design `Dash.html` / `logic.js`). Brand hues (NOT
 * theme-swapped), the range presets, and the per-status / per-kind style maps — no
 * raw hex or magic maps in the component files.
 */
import type {
  ActivityKind,
  ChangeRequestKind,
  ProviderHealth,
} from "@handshake-agent/contracts"
import type { DashboardRangeId } from "@/types"

// Volume-chart capability hues (design logic.js line 2 — NOT theme-swapped).
export const VOL_COLORS = {
  buy: "#1a4536",
  sell: "#2a6f55",
  send: "#5a9b7a",
  swap: "#f5a623",
  ticket: "#e8b96a",
} as const

/** The KPI range presets (design `kpiRanges`, logic.js 487). */
export const KPI_RANGES: readonly DashboardRangeId[] = ["24h", "7d", "30d"]

/** How many rolling days back each preset spans. "24h" → the last 24 hours. */
export const RANGE_DAYS: Record<DashboardRangeId, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
}

/** KYC statuses that count toward the "KYC pending" attention tile (gap matrix). */
export const PENDING_KYC_STATUSES = new Set(["pending", "needs_info"])

/** Short month labels for the "MMM D" bucket axis (UTC, locale-independent). */
export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** Design status-tint tokens per provider status (ok=success, degraded=warn, down=danger). */
export const STATUS_STYLE: Record<
  ProviderHealth["status"],
  { dot: string; halo: string; fg: string }
> = {
  ok: { dot: "#1f8a5b", halo: "rgba(31,138,91,0.18)", fg: "var(--tok)" },
  degraded: { dot: "#e0a53a", halo: "rgba(224,165,58,0.2)", fg: "var(--twn)" },
  down: { dot: "#d0453b", halo: "rgba(208,69,59,0.2)", fg: "var(--tdn)" },
}

/** Per-kind activity icon + tint (settled/kyc/config/failed/sweep/refund rows). */
export const ACTIVITY_STYLE: Record<
  ActivityKind,
  { icon: string; iconBg: string; iconFg: string }
> = {
  settled: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  kyc_approved: {
    icon: "M12 3l7 3v5c0 5-3.5 8-7 9",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
  config_change: {
    icon: "M4 7h16M4 12h10M4 17h7",
    iconBg: "var(--swn)",
    iconFg: "var(--twn)",
  },
  failed: {
    icon: "M12 4l9 16H3z",
    iconBg: "var(--sdn)",
    iconFg: "var(--tdn)",
  },
  sweep: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sok)",
    iconFg: "var(--tok)",
  },
  refund: {
    icon: "M4 8h13l-3-3M20 16H7l3 3",
    iconBg: "var(--sif)",
    iconFg: "var(--tif)",
  },
}

/** Human label per change-request kind (mirrors the Approvals page kind pills). */
export const APPROVAL_KIND_LABEL: Record<ChangeRequestKind, string> = {
  pricing_change: "Pricing change",
  capability_flip: "Capability",
  tier_override: "Tier override",
  refund: "Refund",
  manual_credit: "Manual credit",
  notification_broadcast: "Broadcast",
  payout_release: "Payout release",
  user_tier_override: "User tier override",
}

/** How many awaiting-me requests the dashboard teaser shows. */
export const APPROVALS_PANEL_LIMIT = 3
