import type {
  TreasuryBalance,
  TreasuryExposure,
  TreasuryFiatFloat,
  TreasuryFxPosition,
  TreasuryPayoutQueueItem,
  TreasurySweep,
} from "@handshake-agent/contracts"

import { formatAmount, formatCrypto } from "@/lib/format"
import { EXPOSURE_DOT, SWEEP_LABEL } from "@/constants/treasury"
import type {
  TreasuryCard,
  TreasuryPayoutRow,
  TreasurySweepRow,
} from "@/types/components"

// Amounts arrive as byte-stable decimal strings — format for display only, never for
// math. A non-numeric string falls back to itself so nothing is silently dropped.
const NGN = new Intl.NumberFormat("en-NG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** An NGN decimal string → the "₦42,180,500.00" grouped label (or the raw string). */
export function formatFiat(amount: string): string {
  const n = Number(amount)
  return Number.isFinite(n) ? `₦${NGN.format(n)}` : amount
}

/** Crypto/asset amount → the shared thousands-separated, native-precision format. */
export function formatAssetAmount(amount: string, asset: string): string {
  return formatCrypto(amount, asset)
}

/** basis points → a whole-percent label (e.g. 1802 → "18%"). */
export function bpsToPct(bps: number): string {
  return `${Math.round(bps / 100)}%`
}

/**
 * Resolve the custodial-USDT hero tile from the aggregated balances. Prefer USDT-on-TRON
 * (the launch asset); else the largest-count row. No rows → an em-dash (never fabricated).
 */
export function resolveHeroCard(
  balances: readonly TreasuryBalance[]
): TreasuryCard {
  const primary =
    balances.find(
      (b) => b.asset.toUpperCase() === "USDT" && /tron/i.test(b.network)
    ) ??
    balances.find((b) => b.asset.toUpperCase() === "USDT") ??
    [...balances].sort((a, b) => b.walletCount - a.walletCount)[0]

  if (!primary) {
    return {
      id: "custodial-usdt",
      tone: "hero",
      label: "Custodial · USDT",
      value: "—",
      dot: "ok",
      note: "No custodial wallets",
      live: true,
    }
  }

  const wallets = `${primary.walletCount.toLocaleString()} wallet${
    primary.walletCount === 1 ? "" : "s"
  }`
  return {
    id: "custodial-usdt",
    tone: "hero",
    label: `Custodial · ${primary.asset}`,
    value: formatAssetAmount(primary.totalAmount, primary.asset),
    dot: "ok",
    note: `${wallets} · ${primary.network}`,
    live: true,
  }
}

/**
 * The NGN fiat-float tile: balance + utilization-vs-target + a low/healthy status dot.
 * Falls back to an em-dash when no NGN float row exists (empty), never fabricated.
 */
export function resolveFiatFloatCard(
  floats: readonly TreasuryFiatFloat[]
): TreasuryCard {
  const ngn = floats.find((f) => f.currency === "NGN") ?? floats[0]
  if (!ngn) {
    return {
      id: "ngn-float",
      tone: "neutral",
      label: "NGN fiat float",
      value: "—",
      dot: "warn",
      note: "No fiat-float rows",
      live: true,
    }
  }
  return {
    id: "ngn-float",
    tone: "neutral",
    label: `${ngn.currency} fiat float`,
    value: formatFiat(ngn.balance),
    dot: ngn.status === "low" ? "warn" : "ok",
    note: `${bpsToPct(ngn.utilizationBps)} of target · ${ngn.status}`,
    live: true,
  }
}

/**
 * The FX-position tile: the signed net position valued in fiat + a long/short/flat
 * direction label. Falls back to an em-dash when no position row exists.
 */
export function resolveFxPositionCard(
  positions: readonly TreasuryFxPosition[]
): TreasuryCard {
  const primary =
    positions.find((p) => p.asset.toUpperCase() === "USDT") ?? positions[0]
  if (!primary) {
    return {
      id: "fx-position",
      tone: "neutral",
      label: "FX position",
      value: "—",
      dot: "ok",
      note: "No FX-position rows",
      live: true,
    }
  }
  const dirNote =
    primary.direction === "long"
      ? `Net long ${primary.asset} vs ${primary.fiatCurrency}`
      : primary.direction === "short"
        ? `Net short ${primary.asset} vs ${primary.fiatCurrency}`
        : `Flat ${primary.asset} vs ${primary.fiatCurrency}`
  return {
    id: "fx-position",
    tone: "neutral",
    label: "FX position",
    value: formatFiat(primary.netPositionFiat),
    dot: primary.exposureStatus === "critical" ? "danger" : "ok",
    note: dirNote,
    live: true,
  }
}

/**
 * Resolve the exposure-headroom tile from the derived `headroomBps` of the tightest
 * (lowest-headroom) FX position; falls back to the exposure snapshots' worst status when
 * no FX position row exists.
 */
export function resolveExposureCard(
  exposure: readonly TreasuryExposure[],
  positions: readonly TreasuryFxPosition[]
): TreasuryCard {
  const tightest = [...positions].sort(
    (a, b) => a.headroomBps - b.headroomBps
  )[0]

  if (tightest) {
    const note =
      tightest.exposureStatus === "safe"
        ? "Within inventory limit"
        : tightest.exposureStatus === "warning"
          ? "Approaching inventory limit"
          : "Over inventory limit"
    return {
      id: "exposure-headroom",
      tone: "neutral",
      label: "Exposure headroom",
      value: bpsToPct(tightest.headroomBps),
      dot: EXPOSURE_DOT[tightest.exposureStatus],
      note,
      live: true,
    }
  }

  const severityRank: Record<TreasuryExposure["status"], number> = {
    critical: 2,
    warning: 1,
    safe: 0,
  }
  const worst = [...exposure].sort(
    (a, b) => severityRank[b.status] - severityRank[a.status]
  )[0]

  if (!worst) {
    return {
      id: "exposure-headroom",
      tone: "neutral",
      label: "Exposure headroom",
      value: "—",
      dot: "ok",
      note: "No exposure snapshots",
      live: true,
    }
  }

  const note =
    worst.status === "safe"
      ? "Within inventory limit"
      : worst.status === "warning"
        ? "Approaching inventory limit"
        : "Over inventory limit"
  return {
    id: "exposure-headroom",
    tone: "neutral",
    label: "Exposure headroom",
    value: worst.status,
    dot: EXPOSURE_DOT[worst.status],
    note,
    live: true,
  }
}

/** Map a contract sweep → the design's sweep row (address + gas balance + status). */
export function toSweepRow(s: TreasurySweep): TreasurySweepRow {
  return {
    id: s.id,
    addr: s.address,
    bal: formatAssetAmount(s.balance, s.asset),
    status: SWEEP_LABEL[s.status],
  }
}

/** Map a contract payout-queue item → the design's payout row. */
export function toPayoutRow(p: TreasuryPayoutQueueItem): TreasuryPayoutRow {
  return {
    id: p.id,
    to: p.beneficiaryLabel,
    ref: p.reference,
    method: p.method,
    amt: formatAmount(p.amount, p.asset),
    big: p.requiresApproval,
  }
}
