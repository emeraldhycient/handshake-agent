import type {
  TreasuryBalance,
  TreasuryExposure,
  TreasuryFiatFloat,
  TreasuryFxPosition,
  TreasuryPayoutQueueItem,
  TreasurySweep,
} from "@handshake-agent/contracts"

import { formatAmount, formatCrypto, formatFiat } from "@/lib/format"
import { EXPOSURE_DOT, SWEEP_LABEL } from "@/constants/treasury"
import type {
  TreasuryCard,
  TreasuryPayoutRow,
  TreasurySweepRow,
} from "@/types/components"

// Amounts arrive as byte-stable decimal strings — format for display only,
// never for math. All fiat figures go through the canonical `formatFiat(value,
// currency)` so every card renders in its row's OWN currency (never a pinned ₦).

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
 * The fiat-float tiles — ONE card per currency the float read returns (the API
 * is already per-currency), each formatted in its OWN currency: balance +
 * utilization-vs-target + a low/healthy status dot. No rows → a single em-dash
 * fallback card (never fabricated).
 */
export function resolveFiatFloatCards(
  floats: readonly TreasuryFiatFloat[]
): TreasuryCard[] {
  if (floats.length === 0) {
    return [
      {
        id: "fiat-float",
        tone: "neutral",
        label: "Fiat float",
        value: "—",
        dot: "warn",
        note: "No fiat-float rows",
        live: true,
      },
    ]
  }
  return floats.map((f) => ({
    id: `fiat-float-${f.currency.toLowerCase()}`,
    tone: "neutral",
    label: `${f.currency} fiat float`,
    value: formatFiat(f.balance, f.currency),
    dot: f.status === "low" ? "warn" : "ok",
    note: `${bpsToPct(f.utilizationBps)} of target · ${f.status}`,
    live: true,
  }))
}

/**
 * The FX-position tiles — one card per (asset, fiat) position, the signed net
 * position valued in ITS OWN fiat currency + a long/short/flat direction note.
 * A single position keeps the design's plain "FX position" label; multiple
 * positions disambiguate with the pair. No rows → a single em-dash fallback.
 */
export function resolveFxPositionCards(
  positions: readonly TreasuryFxPosition[]
): TreasuryCard[] {
  if (positions.length === 0) {
    return [
      {
        id: "fx-position",
        tone: "neutral",
        label: "FX position",
        value: "—",
        dot: "ok",
        note: "No FX-position rows",
        live: true,
      },
    ]
  }
  return positions.map((p) => {
    const dirNote =
      p.direction === "long"
        ? `Net long ${p.asset} vs ${p.fiatCurrency}`
        : p.direction === "short"
          ? `Net short ${p.asset} vs ${p.fiatCurrency}`
          : `Flat ${p.asset} vs ${p.fiatCurrency}`
    return {
      id: `fx-position-${p.asset.toLowerCase()}-${p.fiatCurrency.toLowerCase()}`,
      tone: "neutral" as const,
      label:
        positions.length === 1
          ? "FX position"
          : `FX position · ${p.asset}/${p.fiatCurrency}`,
      value: formatFiat(p.netPositionFiat, p.fiatCurrency),
      dot:
        p.exposureStatus === "critical" ? ("danger" as const) : ("ok" as const),
      note: dirNote,
      live: true,
    }
  })
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

/**
 * Map a contract payout-queue item → the design's payout row. `amt` formats the
 * payout amount by its asset (fiat symbol or crypto precision); `fiat` carries
 * the fiat leg in the payout's OWN `fiatCurrency` when the asset is crypto
 * (null when the amount already IS the fiat figure).
 */
export function toPayoutRow(p: TreasuryPayoutQueueItem): TreasuryPayoutRow {
  return {
    id: p.id,
    to: p.beneficiaryLabel,
    ref: p.reference,
    method: p.method,
    amt: formatAmount(p.amount, p.asset),
    fiat:
      p.fiatAmount !== null
        ? `≈ ${formatFiat(p.fiatAmount, p.fiatCurrency)}`
        : null,
    big: p.requiresApproval,
  }
}
