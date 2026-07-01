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
 * WIRING (Phase 6a): the READ-ONLY display data is now sourced from the existing
 * admin treasury hooks — `useTreasuryBalances` (custodial hero), `useTreasuryExposure`
 * (exposure-headroom tile dot/note), `useTreasuryAlerts` (the warning banner), and
 * `useWithdrawalPolicies` (the child-address sweep rows keyed by wallet id). Fields
 * the backend does not yet expose (NGN fiat float, the signed FX-position figure, the
 * exact headroom %, per-child on-chain balance + sweep status, the sweep threshold,
 * and the whole payout approval queue) are rendered design-faithfully or omitted and
 * recorded as shape-gaps for the later backend-enrichment pass — never invented.
 *
 * Funds-safety (root §3.1): nothing here moves money. The Approve action + acknowledge
 * are WRITES left to Phase 7 — "Approve" opens the shared flow modals unchanged.
 *
 * Four async branches (loading / error / empty / data) wrap every wired view.
 */
import { useMemo, useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { MakerCheckerModal, StepUpModal } from "@/components/admin/flows"
import {
  useTreasuryAlerts,
  useTreasuryBalances,
  useTreasuryExposure,
  useWithdrawalPolicies,
} from "@/lib/query/hooks"
import type {
  TreasuryAlert,
  TreasuryBalance,
  TreasuryExposure,
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

// ── Design-faithful fallbacks for fields no endpoint yet provides ──────────────────
// These are design-faithful representative values (SHAPE-GAPs recorded for the
// backend-enrichment pass), NOT fabricated live data — each is clearly marked as a
// non-live tile.

/** The NGN fiat-float tile — no float endpoint yet (aggregates crypto only). */
const NGN_FLOAT_CARD: TreasuryCard = {
  id: "ngn-float",
  tone: "neutral",
  label: "NGN fiat float",
  value: "—",
  dot: "warn",
  note: "No fiat-float endpoint yet",
  live: false,
}

/** The FX-position tile — no signed net-position field on any endpoint. */
const FX_POSITION_CARD: TreasuryCard = {
  id: "fx-position",
  tone: "neutral",
  label: "FX position",
  value: "—",
  dot: "ok",
  note: "No FX-position endpoint yet",
  live: false,
}

/**
 * The payout / withdrawal approval queue (design markup line 11, `payouts`). No
 * approval-queue backend exists yet (SHAPE-GAP), so this stays design-faithful mock;
 * the Approve WRITE is Phase 7. Large payouts (`big`) carry the amber Maker-checker
 * tag and route Approve through dual-control.
 */
const PAYOUTS: readonly TreasuryPayoutRow[] = [
  {
    id: "pay_7741",
    to: "Kelechi Chukwu · GTBank",
    ref: "wd_44219",
    method: "NGN payout · Flutterwave",
    amt: "₦4,820,000.00",
    big: true,
  },
  {
    id: "pay_7742",
    to: "Amara Okeke · TRON withdrawal",
    ref: "wd_44220",
    method: "USDT · Blockradar",
    amt: "1,250.00 USDT",
    big: false,
  },
  {
    id: "pay_7743",
    to: "Ngozi Eze · Access Bank",
    ref: "wd_44221",
    method: "NGN payout · Flutterwave",
    amt: "₦180,000.00",
    big: false,
  },
]

// The child-address sweep balance + status have no endpoint yet (SHAPE-GAP); the row
// ADDRESS is wired from the withdrawal-policy wallet id. These are the design-faithful
// per-row placeholders used until a sweep read model exists.
const SWEEP_PLACEHOLDER_BAL = "—"
const SWEEP_PLACEHOLDER_STATUS: TreasurySweepRow["status"] = "Pending"

// design-faithful: the sweep threshold has no admin endpoint yet — it mirrors the
// `sweep.threshold.trx` seed setting (25 TRX). SHAPE-GAP recorded.
const SWEEP_THRESHOLD = "25 TRX"

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
 * Resolve the exposure-headroom tile from the exposure snapshots. The endpoint does
 * NOT expose a single "headroom %" scalar (SHAPE-GAP), so the value renders an
 * em-dash; the dot + note are driven by the most-severe row's real status.
 */
function resolveExposureCard(
  exposure: readonly TreasuryExposure[]
): TreasuryCard {
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
    // No headroom-% field on the endpoint (SHAPE-GAP) — surface the real status label.
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
  const policiesQuery = useWithdrawalPolicies()

  // ── Balance cards ─────────────────────────────────────────────────────────────
  // Tile 0 (hero) + tile 3 (exposure) are wired; tiles 1–2 (fiat float, FX) have no
  // endpoint and render design-faithful non-live placeholders (SHAPE-GAPs).
  const cards: TreasuryCard[] = useMemo(() => {
    const hero = resolveHeroCard(balancesQuery.data?.balances ?? [])
    const exposure = resolveExposureCard(exposureQuery.data?.items ?? [])
    return [hero, NGN_FLOAT_CARD, FX_POSITION_CARD, exposure]
  }, [balancesQuery.data, exposureQuery.data])

  const cardsLoading = balancesQuery.isLoading || exposureQuery.isLoading
  const cardsError = balancesQuery.isError || exposureQuery.isError

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

  // ── Child-address sweeps ──────────────────────────────────────────────────────
  // Row ADDRESS is wired from each withdrawal policy's wallet id; balance + sweep
  // status have no endpoint (SHAPE-GAPs) → design-faithful placeholders.
  const sweeps: TreasurySweepRow[] = useMemo(
    () =>
      (policiesQuery.data?.items ?? []).map((policy) => ({
        id: policy.id,
        addr: policy.walletId,
        bal: SWEEP_PLACEHOLDER_BAL,
        status: SWEEP_PLACEHOLDER_STATUS,
      })),
    [policiesQuery.data]
  )

  // ── Payout approval flow (WRITE — Phase 7, unchanged) ─────────────────────────
  // `flow` tracks which step-modal is open; the active row drives the modal copy.
  // No server call — approving simply advances through the shared funds-safety modals
  // then clears the row from the queue.
  const [flow, setFlow] = useState<null | "maker" | "stepup">(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [approved, setApproved] = useState<Record<string, boolean>>({})

  const active = PAYOUTS.find((p) => p.id === activeId) ?? null

  // Large payouts (design `p.big`) require maker-checker before step-up; smaller
  // ones go straight to step-up — matching the design's dual-control gate.
  function onApprove(row: TreasuryPayoutRow) {
    setActiveId(row.id)
    setFlow(row.big ? "maker" : "stepup")
  }

  function closeFlow() {
    setFlow(null)
    setActiveId(null)
  }

  function finishApprove() {
    if (activeId) setApproved((prev) => ({ ...prev, [activeId]: true }))
    closeFlow()
  }

  // The maker-checker change-preview diff for the active large payout.
  const makerDiff: MakerCheckerDiffRow[] = active
    ? [
        {
          field: `Payout ${active.ref}`,
          from: "Pending approval",
          to: "Approved · queued for engine",
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

      {/* ── Threshold-breach warning (from real alerts) ─────────────────────── */}
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
            className="text-twn"
          >
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[12.5px] font-semibold text-twn">
            Exposure alert · {topAlert.message}
          </span>
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
        {/* Payout / withdrawal approval queue — maker-checker on large amounts.
            No approval-queue endpoint yet (SHAPE-GAP): design-faithful mock; the
            Approve WRITE is Phase 7. */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold text-ink">
              Payout / withdrawal approval queue
            </div>
            <span className="text-[11px] font-semibold text-ink3">
              Large payouts require maker-checker
            </span>
          </div>

          {PAYOUTS.map((row) => {
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
                    Approved
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
          })}
        </div>

        {/* Child-address sweeps — wallet ids from real withdrawal policies; per-row
            balance + sweep status are design-faithful (SHAPE-GAPs). */}
        <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
          <div className="mb-3.5 text-[13px] font-extrabold text-ink">
            Child-address sweeps
          </div>

          {policiesQuery.isError ? (
            <div className="py-4 text-center">
              <p className="text-[12.5px] font-semibold text-tdn">
                Failed to load sweeps
              </p>
              <button
                type="button"
                onClick={() => void policiesQuery.refetch()}
                className="mt-2 rounded-[9px] bg-btn-dark px-3 py-1.5 text-[11.5px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Retry
              </button>
            </div>
          ) : policiesQuery.isLoading ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
            </div>
          ) : sweeps.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink3">
              No child addresses under a withdrawal policy.
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

          {/* Sweep threshold footer (design-faithful — no config read on this
              screen yet; SHAPE-GAP). */}
          <div className="mt-3.5 flex justify-between border-t border-line2 pt-3">
            <span className="text-[11.5px] text-ink3">Sweep threshold</span>
            <span className="font-mono text-[12px] font-bold text-ink tabular-nums">
              {SWEEP_THRESHOLD}
            </span>
          </div>
        </div>
      </div>

      {/* ── Funds-safety flow modals (design §5) ────────────────────────────── */}
      <MakerCheckerModal
        open={flow === "maker"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `Approve payout ${active.ref}` : "Approve payout"}
        diff={makerDiff}
        onSubmit={() => setFlow("stepup")}
      />
      <StepUpModal
        open={flow === "stepup"}
        onOpenChange={(open) => (open ? undefined : closeFlow())}
        title={active ? `payout ${active.ref}` : "payout approval"}
        onComplete={finishApprove}
      />
    </div>
  )
}
