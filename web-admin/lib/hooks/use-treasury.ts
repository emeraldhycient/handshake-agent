"use client"

import { useMemo, useState } from "react"

import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import { pushToast } from "@/lib/store/toast-store"
import {
  resolveExposureCard,
  resolveFiatFloatCard,
  resolveFxPositionCard,
  resolveHeroCard,
  toPayoutRow,
  toSweepRow,
  formatAssetAmount,
} from "@/lib/treasury/cards"
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
import type { TreasuryAlert } from "@handshake-agent/contracts"
import type {
  MakerCheckerDiffRow,
  TreasuryCard,
  TreasuryPayoutRow,
} from "@/types/components"

/**
 * The Treasury oversight view-model: the seven live reads (custodial hero, fiat float,
 * FX position, exposure headroom, alerts, sweeps, payout queue) + the cooling-off
 * beneficiaries, and the payout-approval maker-checker state machine. Nothing here moves
 * money (§3.1) — approving raises a four-eyes `payout_release` change request that a
 * SECOND admin confirms; the mutation is step-up-gated and replays on a 403. Extracted
 * from the page so the orchestrator is pure composition.
 */
export function useTreasury() {
  const balancesQuery = useTreasuryBalances()
  const exposureQuery = useTreasuryExposure()
  const alertsQuery = useTreasuryAlerts()
  const sweepsQuery = useTreasurySweeps()
  const payoutQuery = useTreasuryPayoutQueue()
  const fiatFloatQuery = useTreasuryFiatFloat()
  const fxQuery = useTreasuryFxPosition()
  const beneficiariesQuery = useAdminBeneficiaries()

  // Beneficiaries still inside their first-use cooling-off window — the only ones the
  // override applies to. The wired BeneficiaryOverride renders nothing for cleared ones.
  const coolingOff = useMemo(
    () =>
      (beneficiariesQuery.data?.items ?? []).filter((b) => b.coolingOffActive),
    [beneficiariesQuery.data]
  )

  // ── Balance cards ──
  const cards: TreasuryCard[] = useMemo(() => {
    const fx = fxQuery.data?.items ?? []
    return [
      resolveHeroCard(balancesQuery.data?.balances ?? []),
      resolveFiatFloatCard(fiatFloatQuery.data?.items ?? []),
      resolveFxPositionCard(fx),
      resolveExposureCard(exposureQuery.data?.items ?? [], fx),
    ]
  }, [
    balancesQuery.data,
    fiatFloatQuery.data,
    fxQuery.data,
    exposureQuery.data,
  ])

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

  function refetchCards() {
    void balancesQuery.refetch()
    void exposureQuery.refetch()
    void fiatFloatQuery.refetch()
    void fxQuery.refetch()
  }

  // ── Warning banner (highest-severity unacknowledged alert) ──
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

  // ── Child-address sweeps ──
  const sweeps = useMemo(
    () => (sweepsQuery.data?.items ?? []).map(toSweepRow),
    [sweepsQuery.data]
  )
  const sweepThreshold = sweepsQuery.data
    ? formatAssetAmount(
        sweepsQuery.data.sweepThreshold,
        sweepsQuery.data.thresholdAsset
      )
    : "—"

  // ── Payout / withdrawal approval queue ──
  const payouts = useMemo(
    () => (payoutQuery.data?.items ?? []).map(toPayoutRow),
    [payoutQuery.data]
  )

  // ── Payout approval flow (WIRED — maker-checker → step-up) ──
  const me = useAdminMe()
  const approvePayout = useApproveTreasuryPayout()
  const stepUp = useStepUpRetry()
  const [flow, setFlow] = useState<null | "reason" | "maker">(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [approved, setApproved] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const active = payouts.find((p) => p.id === activeId) ?? null

  function onApprove(row: TreasuryPayoutRow) {
    setActiveId(row.id)
    setLocalError(null)
    setFlow("reason")
  }

  function closeFlow() {
    setFlow(null)
    setActiveId(null)
  }

  function captureReason(next: string) {
    setReason(next)
    setFlow("maker")
  }

  // The maker-checker CTA fires the REAL approve mutation via step-up-retry. On success
  // the row shows "Requested" (the release awaits a second admin, §3.1).
  function submitApprove() {
    const id = activeId
    if (id === null) return
    closeFlow()
    void (async () => {
      try {
        const completed = await stepUp.run(() =>
          approvePayout.mutateAsync({ id, input: { reason } }).then(() => {
            pushToast(
              "Payout approval requested · awaiting second admin",
              "info"
            )
          })
        )
        if (completed) {
          setApproved((prev) => ({ ...prev, [id]: true }))
          setReason("")
        }
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

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

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((done) => {
        if (done && activeId) {
          setApproved((prev) => ({ ...prev, [activeId]: true }))
          setReason("")
        }
      })
      .catch((error) => setLocalError(toErrorMessage(error)))
  }

  return {
    cards,
    cardsLoading,
    cardsError,
    refetchCards,
    topAlert,
    sweeps,
    sweepThreshold,
    sweepsQuery,
    payouts,
    payoutQuery,
    coolingOff,
    me,
    stepUp,
    flow,
    active,
    approved,
    reason,
    localError,
    onApprove,
    closeFlow,
    captureReason,
    submitApprove,
    makerDiff,
    onStepUpSuccess,
  }
}
