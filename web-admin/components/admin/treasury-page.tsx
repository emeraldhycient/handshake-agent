"use client"

/**
 * TreasuryPage — the treasury oversight surface (design §6.13 Treasury), a
 * pixel-faithful reproduction of `docs/design-ref/screens/Treasury.html`:
 *
 *   • an optional low-float / threshold-breach warning banner,
 *   • a 4-up balance-card row whose first tile is the dark-green custodial hero
 *     (custodial USDT, NGN fiat float, FX position, exposure headroom),
 *   • a 1.5fr / 1fr grid: the payout / withdrawal approval queue (maker-checker
 *     tag + Approve on large payouts) alongside the child-address sweeps list
 *     (+ the 25 TRX sweep threshold footer).
 *
 * WIRING (Phase 6b): every read on this screen is now live. The four balance tiles
 * come from `useTreasuryBalances` (custodial hero), `useTreasuryFiatFloat` (NGN float
 * vs target), `useTreasuryFxPosition` (signed net position + the derived headroom %),
 * and `useTreasuryExposure` (fallback status). The warning banner is `useTreasuryAlerts`;
 * the child-address sweep list (address + gas balance + lifecycle + threshold) is
 * `useTreasurySweeps`; the payout / withdrawal approval queue is `useTreasuryPayoutQueue`
 * (pending outbound settlements). Money strings are formatted for display only.
 *
 * Funds-safety (root §3.1): nothing here moves money. The Phase-7 WRITES are wired
 * through canonical step-up-gated components: the banner's "Acknowledge" is
 * `TreasuryAlertAcknowledge` (useAcknowledgeAlert, reason → step-up), and the
 * beneficiary cooling-off override is the wired `BeneficiaryOverride`
 * (useOverrideCoolingOff). The payout "Approve" opens the shared maker-checker /
 * step-up flow. Each mutation invalidates its query so the affected view re-resolves.
 *
 * Four async branches (loading / error / empty / data) wrap every wired view.
 */
import { useMemo, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { MakerCheckerModal, ReasonModal } from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { TreasuryAlertAcknowledge } from "@/components/admin/treasury-alert-acknowledge"
import { BeneficiaryOverride } from "@/components/admin/beneficiary-override"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { ApiError } from "@/lib/api/client"
import { pushToast } from "@/lib/store/toast-store"
import {
  useAdminBeneficiaries,
  useAdminMe,
  useApproveTreasuryPayout,
  useTreasuryAlerts,
  useTreasuryBalances,
  useTreasuryExposure,
  useTreasuryFiatFloat,
  useTreasuryFxPosition,
  useTreasuryPayoutQueue,
  useTreasurySweeps,
} from "@/lib/query/hooks"
import type {
  TreasuryAlert,
  TreasuryBalance,
  TreasuryExposure,
  TreasuryFiatFloat,
  TreasuryFxPosition,
  TreasuryPayoutQueueItem,
  TreasurySweep,
} from "@handshake-agent/contracts"
import type {
  MakerCheckerDiffRow,
  TreasuryCard,
  TreasuryPayoutRow,
  TreasurySweepRow,
} from "@/types/components"

// ── Brand constants (the only permitted non-token colour source, §7) ──────────────
// The custodial hero tile is a dark-green gradient identical in both themes (§5 KPI
// hero); the delta-dot on the hero is amber.
const HERO_GRADIENT =
  "linear-gradient(150deg, var(--brand-green) 0%, var(--brand-green-deep) 100%)"

// ── Money formatting (grouped thousands; no shared formatter exists in web-admin) ──
// Amounts arrive as byte-stable decimal strings — format for display only, never for
// math. A non-numeric string falls back to itself so nothing is silently dropped.
const NGN = new Intl.NumberFormat("en-NG", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function formatFiat(amount: string): string {
  const n = Number(amount)
  return Number.isFinite(n) ? `₦${NGN.format(n)}` : amount
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

function formatAssetAmount(amount: string, asset: string): string {
  const n = Number(amount)
  return Number.isFinite(n) ? `${NGN.format(n)} ${asset}` : `${amount} ${asset}`
}

/** basis points → a whole-percent label (e.g. 1802 → "18%"). */
function bpsToPct(bps: number): string {
  return `${Math.round(bps / 100)}%`
}

/** Map a contract sweep status → the design's row label. */
const SWEEP_LABEL: Record<TreasurySweep["status"], TreasurySweepRow["status"]> =
  {
    swept: "Swept",
    pending: "Pending",
    below_threshold: "Below threshold",
  }

/**
 * The NGN fiat-float tile from the real platform_float aggregation: balance +
 * utilization-vs-target + a low/healthy status dot. Falls back to an em-dash when no
 * NGN float row exists (empty), never fabricated.
 */
function resolveFiatFloatCard(
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
 * The FX-position tile from the real net-position aggregation: the signed net
 * position valued in fiat + a long/short/flat direction label. Falls back to an
 * em-dash when no position row exists.
 */
function resolveFxPositionCard(
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

// A balance-card health dot's semantic → its token utility. Colour is never the sole
// signal — each dot is paired with a note that carries the same meaning.
const DOT_CLASS: Record<TreasuryCard["dot"], string> = {
  ok: "bg-tok",
  warn: "bg-twn",
  danger: "bg-tdn",
}

// A sweep status → its dot + label token utilities (matching the design's per-row
// `s.dot` / `s.fg`). Swept reads success, Pending warning, Below-threshold muted.
const SWEEP_STATUS: Record<
  TreasurySweepRow["status"],
  { dot: string; fg: string }
> = {
  Swept: { dot: "bg-tok", fg: "text-tok" },
  Pending: { dot: "bg-twn", fg: "text-twn" },
  "Below threshold": { dot: "bg-ink3", fg: "text-ink3" },
}

// Exposure status → the headroom tile's health dot (colour never the sole signal —
// the note carries the same meaning).
const EXPOSURE_DOT: Record<TreasuryExposure["status"], TreasuryCard["dot"]> = {
  safe: "ok",
  warning: "warn",
  critical: "danger",
}

/**
 * Resolve the custodial-USDT hero tile from the aggregated balances. Prefer the
 * USDT-on-TRON row (the launch asset); otherwise fall back to the largest-count row.
 * When no balance rows exist the hero renders an em-dash (empty), never fabricated.
 */
function resolveHeroCard(balances: readonly TreasuryBalance[]): TreasuryCard {
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
    value: primary.totalAmount,
    dot: "ok",
    note: `${wallets} · ${primary.network}`,
    live: true,
  }
}

/**
 * Resolve the exposure-headroom tile. The FX-position endpoint now carries a derived
 * `headroomBps` scalar, so the tile shows the real headroom % of the tightest (lowest
 * headroom) position; the dot + note are driven by that position's real status. Falls
 * back to the exposure snapshots' worst status when no FX position row exists.
 */
function resolveExposureCard(
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

/** A single balance tile — the hero variant carries the dark-green gradient. */
function BalanceCard({ card }: { card: TreasuryCard }) {
  const hero = card.tone === "hero"
  return (
    <div
      style={hero ? { background: HERO_GRADIENT } : undefined}
      className={
        hero
          ? "rounded-2xl border border-transparent px-[18px] py-4 text-white"
          : "rounded-2xl border border-line bg-card px-[18px] py-4 text-ink"
      }
    >
      <div
        className={
          hero
            ? "text-[11.5px] font-semibold text-on-brand-muted"
            : "text-[11.5px] font-semibold text-ink3"
        }
      >
        {card.label}
      </div>
      <div className="mt-[5px] font-mono text-[21px] font-extrabold tracking-[-0.01em] tabular-nums">
        {card.value}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-[7px] shrink-0 rounded-full ${
            hero ? "bg-brand-amber" : DOT_CLASS[card.dot]
          }`}
        />
        <span
          className={
            hero ? "text-[11px] text-on-brand-muted" : "text-[11px] text-ink3"
          }
        >
          {card.note}
        </span>
      </div>
    </div>
  )
}

/** A single balance-tile skeleton matching the tile's height + radius. */
function BalanceCardSkeleton() {
  return <Skeleton className="h-[104px] rounded-2xl" />
}

export function TreasuryPage() {
  const balancesQuery = useTreasuryBalances()
  const exposureQuery = useTreasuryExposure()
  const alertsQuery = useTreasuryAlerts()
  const sweepsQuery = useTreasurySweeps()
  const payoutQuery = useTreasuryPayoutQueue()
  const fiatFloatQuery = useTreasuryFiatFloat()
  const fxQuery = useTreasuryFxPosition()
  const beneficiariesQuery = useAdminBeneficiaries()

  // Beneficiaries still inside their first-use cooling-off window — the only ones
  // the override (useOverrideCoolingOff) applies to. The wired BeneficiaryOverride
  // renders nothing for cleared beneficiaries, so we pre-filter to keep the panel tight.
  const coolingOff = useMemo(
    () =>
      (beneficiariesQuery.data?.items ?? []).filter((b) => b.coolingOffActive),
    [beneficiariesQuery.data]
  )

  // ── Balance cards ─────────────────────────────────────────────────────────────
  // All four tiles are now wired to real reads: custodial hero (balances), NGN fiat
  // float (platform_float aggregation), FX position (net-position aggregation), and
  // exposure headroom (the derived headroom-% scalar off the FX-position endpoint).
  const cards: TreasuryCard[] = useMemo(() => {
    const fx = fxQuery.data?.items ?? []
    return [
      resolveHeroCard(balancesQuery.data?.balances ?? []),
      resolveFiatFloatCard(fiatFloatQuery.data?.items ?? []),
      resolveFxPositionCard(fx),
      resolveExposureCard(exposureQuery.data?.items ?? [], fx),
    ]
  }, [balancesQuery.data, fiatFloatQuery.data, fxQuery.data, exposureQuery.data])

  const cardsLoading =
    balancesQuery.isLoading ||
    exposureQuery.isLoading ||
    fiatFloatQuery.isLoading ||
    fxQuery.isLoading
  const cardsError =
    balancesQuery.isError ||
    exposureQuery.isError ||
    fiatFloatQuery.isError ||
    fxQuery.isError

  // ── Warning banner ────────────────────────────────────────────────────────────
  // Surfaced from the real threshold-breach alerts (highest-severity unacknowledged
  // one). Acknowledge is a WRITE left to Phase 7. The design's hardcoded NGN low-float
  // banner has no endpoint (SHAPE-GAP), so the banner now reflects real alerts.
  const topAlert = useMemo<TreasuryAlert | null>(() => {
    const items = alertsQuery.data?.items ?? []
    const rank: Record<TreasuryAlert["severity"], number> = {
      critical: 2,
      warning: 1,
      info: 0,
    }
    return (
      [...items]
        .filter((a) => a.acknowledgedAt === null)
        .sort((a, b) => rank[b.severity] - rank[a.severity])[0] ?? null
    )
  }, [alertsQuery.data])

  // ── Child-address sweeps (real read: address + gas balance + lifecycle) ────────
  const sweeps: TreasurySweepRow[] = useMemo(
    () =>
      (sweepsQuery.data?.items ?? []).map((s: TreasurySweep) => ({
        id: s.id,
        addr: s.address,
        bal: formatAssetAmount(s.balance, s.asset),
        status: SWEEP_LABEL[s.status],
      })),
    [sweepsQuery.data]
  )

  // The sweep threshold now comes from the endpoint (mirrors sweep.threshold.trx).
  const sweepThreshold = sweepsQuery.data
    ? `${sweepsQuery.data.sweepThreshold} ${sweepsQuery.data.thresholdAsset}`
    : "—"

  // ── Payout / withdrawal approval queue (real read; Approve WRITE is Phase 7) ────
  const payouts: TreasuryPayoutRow[] = useMemo(
    () =>
      (payoutQuery.data?.items ?? []).map((p: TreasuryPayoutQueueItem) => ({
        id: p.id,
        to: p.beneficiaryLabel,
        ref: p.reference,
        method: p.method,
        amt:
          p.asset === "NGN"
            ? formatFiat(p.amount)
            : formatAssetAmount(p.amount, p.asset),
        big: p.requiresApproval,
      })),
    [payoutQuery.data]
  )

  // ── Payout approval flow (WRITE — Phase 7, WIRED — maker-checker) ─────────────
  // Approving raises a four-eyes `payout_release` change request via the real
  // mutation — it releases NO money here; a SECOND admin confirms, and the apply
  // re-drives settlement through the engine (§3.1). The flow is reason (audit) →
  // maker-checker (dual-control preview) → the REAL mutation (step-up-gated).
  const me = useAdminMe()
  const approvePayout = useApproveTreasuryPayout()
  const stepUp = useStepUpRetry()
  const [flow, setFlow] = useState<null | "reason" | "maker">(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const active = payouts.find((p) => p.id === activeId) ?? null

  // Every payout approval is captured behind maker-checker on the server (it raises a
  // four-eyes change request). The reason modal captures the audited justification.
  function onApprove(row: TreasuryPayoutRow) {
    setActiveId(row.id)
    setLocalError(null)
    setFlow("reason")
  }

  function closeFlow() {
    setFlow(null)
    setActiveId(null)
  }

  // The maker-checker CTA fires the REAL approve mutation via step-up-retry. On
  // success the row shows "Requested" (the release awaits a second admin, §3.1).
  function submitApprove() {
    const id = activeId
    if (id === null) return
    closeFlow()
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          approvePayout
            .mutateAsync({ id, input: { reason } })
            .then(() => {
              pushToast("Payout approval requested · awaiting second admin", "info")
            })
        )
        if (completed) {
          setApproved((prev) => ({ ...prev, [id]: true }))
          setReason("")
        }
      } catch (error) {
        setLocalError(errorMessage(error))
      }
    })()
  }

  // The maker-checker change-preview diff for the active payout.
  const makerDiff: MakerCheckerDiffRow[] = active
    ? [
        {
          field: `Payout ${active.ref}`,
          from: "Pending approval",
          to: "Requested · four-eyes release",
        },
        { field: "Amount", from: "—", to: active.amt },
      ]
    : []

  return (
    <div className="mx-auto w-full max-w-[1300px] flex-1 overflow-y-auto p-[26px_30px_60px]">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          Treasury
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Custodial wallet balances, fiat float, FX position and the payout
          approval queue.
        </p>
      </div>

      {/* ── Threshold-breach warning (from real alerts) — with acknowledge ──── */}
      {topAlert && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2.5 rounded-xl border border-[#f0e2c4] bg-swn px-4 py-3"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-twn"
          >
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex-1 text-[12.5px] font-semibold text-twn">
            Exposure alert · {topAlert.message}
          </span>
          <TreasuryAlertAcknowledge alert={topAlert} />
        </div>
      )}

      {/* ── Balance cards (dark custodial hero) ─────────────────────────────── */}
      {cardsError ? (
        <div className="mb-4 rounded-2xl border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-[13px] font-bold text-tdn">
            Failed to load treasury balances
          </p>
          <button
            type="button"
            onClick={() => {
              void balancesQuery.refetch()
              void exposureQuery.refetch()
              void fiatFloatQuery.refetch()
              void fxQuery.refetch()
            }}
            className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      ) : cardsLoading ? (
        <div
          className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4"
          aria-busy="true"
        >
          <BalanceCardSkeleton />
          <BalanceCardSkeleton />
          <BalanceCardSkeleton />
          <BalanceCardSkeleton />
        </div>
      ) : (
        <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          {cards.map((card) => (
            <BalanceCard key={card.id} card={card} />
          ))}
        </div>
      )}

      {/* ── Approval queue | Child-address sweeps (1.5fr / 1fr) ─────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Payout / withdrawal approval queue — real pending payouts (read-only);
            maker-checker on large amounts. The Approve WRITE is Phase 7. */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold text-ink">
              Payout / withdrawal approval queue
            </div>
            <span className="text-[11px] font-semibold text-ink3">
              Large payouts require maker-checker
            </span>
          </div>

          {payoutQuery.isError ? (
            <div className="py-4 text-center">
              <p className="text-[12.5px] font-semibold text-tdn">
                Failed to load payout queue
              </p>
              <button
                type="button"
                onClick={() => void payoutQuery.refetch()}
                className="mt-2 rounded-[9px] bg-btn-dark px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Retry
              </button>
            </div>
          ) : payoutQuery.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-12 rounded-md" />
              <Skeleton className="h-12 rounded-md" />
              <Skeleton className="h-12 rounded-md" />
            </div>
          ) : payouts.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink3">
              No payouts awaiting release.
            </p>
          ) : (
            payouts.map((row) => {
              const done = approved[row.id]
              return (
                <div
                  key={row.id}
                  className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-ink">
                      {row.to}
                    </div>
                    <div className="font-mono text-[11px] text-ink3">
                      {row.ref} · {row.method}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-[13.5px] font-extrabold text-ink tabular-nums">
                    {row.amt}
                  </div>
                  {row.big && (
                    <span className="shrink-0 rounded-md bg-swn px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.02em] text-twn uppercase">
                      Maker-checker
                    </span>
                  )}
                  {done ? (
                    <span className="shrink-0 rounded-[9px] bg-sok px-3.5 py-2 text-[12px] font-bold text-tok">
                      Requested
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onApprove(row)}
                      className={`shrink-0 rounded-[9px] px-3.5 py-2 text-[12px] font-bold transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                        row.big
                          ? "bg-btn-dark text-white"
                          : "bg-brand-green text-white"
                      }`}
                    >
                      Approve
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Child-address sweeps — real per-child address + gas balance + sweep
            lifecycle from the sweeps read model. */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 text-[13px] font-extrabold text-ink">
            Child-address sweeps
          </div>

          {sweepsQuery.isError ? (
            <div className="py-4 text-center">
              <p className="text-[12.5px] font-semibold text-tdn">
                Failed to load sweeps
              </p>
              <button
                type="button"
                onClick={() => void sweepsQuery.refetch()}
                className="mt-2 rounded-[9px] bg-btn-dark px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Retry
              </button>
            </div>
          ) : sweepsQuery.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
            </div>
          ) : sweeps.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink3">
              No child addresses to sweep.
            </p>
          ) : (
            sweeps.map((sweep) => {
              const tone = SWEEP_STATUS[sweep.status]
              return (
                <div
                  key={sweep.id}
                  className="flex items-center gap-2.5 border-b border-line2 py-2.5"
                >
                  <span
                    aria-hidden="true"
                    className={`size-2 shrink-0 rounded-full ${tone.dot}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink2">
                    {sweep.addr}
                  </span>
                  <span className="shrink-0 font-mono text-[12px] font-bold text-ink tabular-nums">
                    {sweep.bal}
                  </span>
                  <span
                    className={`shrink-0 text-[10.5px] font-bold ${tone.fg}`}
                  >
                    {sweep.status}
                  </span>
                </div>
              )
            })
          )}

          {/* Sweep threshold footer — from the sweeps endpoint (mirrors the
              sweep.threshold.trx setting). */}
          <div className="mt-3.5 flex justify-between border-t border-line2 pt-3">
            <span className="text-[11.5px] text-ink3">Sweep threshold</span>
            <span className="font-mono text-[12px] font-bold text-ink tabular-nums">
              {sweepThreshold}
            </span>
          </div>
        </div>
      </div>

      {/* ── Beneficiaries in cooling-off (first-use lock override, IDN-08) ──── */}
      {/* Shown only when at least one payout destination is still locked. The
          override write is the step-up-gated BeneficiaryOverride (useOverrideCoolingOff);
          on success the beneficiaries query is invalidated so the row clears. */}
      {coolingOff.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold text-ink">
              Beneficiaries in cooling-off
            </div>
            <span className="text-[11px] font-semibold text-ink3">
              First-use lock · override requires step-up
            </span>
          </div>
          {coolingOff.map((beneficiary) => (
            <div
              key={beneficiary.id}
              className="flex items-center gap-3 border-b border-line2 py-3 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-bold text-ink">
                  {beneficiary.label}
                </div>
                <div className="truncate font-mono text-[11px] text-ink3">
                  {beneficiary.type === "bank_account"
                    ? "Bank account"
                    : "USDT address"}
                </div>
              </div>
              <span className="shrink-0 rounded-md bg-swn px-2 py-[3px] text-[9.5px] font-extrabold tracking-[0.02em] text-twn uppercase">
                Cooling-off
              </span>
              <BeneficiaryOverride beneficiary={beneficiary} />
            </div>
          ))}
        </div>
      )}

      {/* ── Payout approval flow (WIRED): reason (audit) → maker-checker → the REAL
          approve mutation (step-up-gated). Raising the approval releases NO money —
          it enters the four-eyes inbox for a second admin to confirm (§3.1). */}
      <ReasonModal
        open={flow === "reason"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `Approve payout ${active.ref}` : "Approve payout"}
        onContinue={(r, category) => {
          setReason(category ? `${category}: ${r}` : r)
          setFlow("maker")
        }}
      />
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `Approve payout ${active.ref}` : "Approve payout"}
        diff={makerDiff}
        onSubmit={submitApprove}
      />

      {/* Real step-up: opened when the approve mutation 403s; replays on re-auth. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
          void stepUp
            .retry()
            .then((done) => {
              if (done && activeId) {
                setApproved((prev) => ({ ...prev, [activeId]: true }))
                setReason("")
              }
            })
            .catch((error) => setLocalError(errorMessage(error)))
        }}
      />
      {localError && (
        <p role="alert" className="mt-3 text-[12px] font-semibold text-tdn">
          {localError}
        </p>
      )}
    </div>
  )
}
