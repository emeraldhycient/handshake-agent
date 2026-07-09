"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type { SupportedAsset } from "@handshake-agent/contracts"

import { pushToast } from "@/lib/store/toast-store"
import { ApiError } from "@/lib/api/client"
import {
  useAdminCatalog,
  useAdminMe,
  useApproveKyc,
  useCreateChange,
  useCreateUserNote,
  useEndUserDetail,
  useEndUserDevices,
  useEndUserLimits,
  useEndUserSessions,
  useEndUserTimeline,
  useForcePinReset,
  useForceReKyc,
  useKycSubmission,
  useRejectKyc,
  useRemoveBeneficiary,
  useRequestKycInfo,
  useRequestManualCredit,
  useResendVerification,
  useRevokeAllUserSessions,
  useRevokeDevice,
  useRevokeUserSession,
  useSetUserStatus,
  useSimSwapReverify,
  useUserNotes,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { approveTargetTier } from "@/lib/users/user-detail"
import { TABS, TIER_OVERRIDE_TARGET } from "@/constants/user-detail"
import type { UdFlowConfig, UdFlowStep, UdTab } from "@/types/components"

/**
 * View-model for the UserDetail screen. Owns the tab state, the per-tab read
 * queries, and the sequential flow-modal machine that drives every KYC decision +
 * account action (freeze / tier-override / PIN-reset / SIM-swap / force-re-KYC /
 * session + device + beneficiary revocation / manual-credit / notes).
 *
 * Funds/identity safety (§3.1/§3.3/§3.4): the model only proposes. Each sensitive
 * mutation runs through `runStepUpMutation` → `useStepUpRetry`, so a 403
 * ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog and replays after re-auth.
 * Manual-credit AND the per-user tier override are the four-eyes maker-checker requests
 * here (both land in a SECOND admin's approvals inbox — manual-credit via
 * POST /admin/users/:id/credit, the tier override via a `user_tier_override`
 * ChangeRequest on POST /admin/approvals — so their maker step is honest dual-control).
 * Nothing here writes a raw ledger entry or moves money.
 */
export function useUserDetailScreen(userId: string) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Real-data reads: the aggregate gates the shell; the rest back their tabs.
  const detailQuery = useEndUserDetail(userId)
  const kycQuery = useKycSubmission(userId)
  const devicesQuery = useEndUserDevices(userId)
  const sessionsQuery = useEndUserSessions(userId)
  // Limits-tab currency scope: null → the server's registry-default fiat; a
  // chip selection re-reads the endpoint with `?currency=<CODE>` (validated
  // server-side against the live catalog, §3.3). Options come from the same
  // catalog read that drives every currency filter.
  const [limitsCurrency, setLimitsCurrency] = useState<string | null>(null)
  const limitsQuery = useEndUserLimits(userId, limitsCurrency)
  const catalogQuery = useAdminCatalog()
  const limitsCurrencyOptions = useMemo(
    () => catalogQuery.data?.fiats.map((f) => f.code) ?? [],
    [catalogQuery.data]
  )
  const timelineQuery = useEndUserTimeline(userId)
  const notesQuery = useUserNotes(userId)

  // Sensitive mutations (Phase 7/9 WRITE) — KYC decisions + account actions. Each is
  // step-up-gated: a 403 ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog, then the
  // stashed action replays via `stepUp.retry`. The hooks invalidate the KYC queue +
  // the ["admin","users"] prefix, so this header + the affected tabs re-resolve.
  const me = useAdminMe()
  const approveKyc = useApproveKyc()
  const rejectKyc = useRejectKyc()
  const createChange = useCreateChange()
  const setUserStatus = useSetUserStatus()
  const forcePinReset = useForcePinReset()
  const revokeDevice = useRevokeDevice()
  const simSwapReverify = useSimSwapReverify()
  const requestManualCredit = useRequestManualCredit()
  const requestKycInfo = useRequestKycInfo()
  const forceReKyc = useForceReKyc()
  const revokeAllUserSessions = useRevokeAllUserSessions()
  const revokeUserSession = useRevokeUserSession()
  const createUserNote = useCreateUserNote()
  const removeBeneficiary = useRemoveBeneficiary()
  const resendVerification = useResendVerification()
  const stepUp = useStepUpRetry()

  // Deep-link tab: seed from ?tab= when it names a valid tab (KYC-queue links land on KYC).
  const [tab, setTab] = useState<UdTab>(() => {
    const q = searchParams.get("tab")
    return TABS.some((t) => t.id === q) ? (q as UdTab) : "profile"
  })

  // Sequential flow-modal machine: the active step index walks the config's steps.
  const [flow, setFlow] = useState<UdFlowConfig | null>(null)
  const [flowStep, setFlowStep] = useState(0)
  // The manual-credit input captured by the ManualCreditModal (the "credit" step).
  // Mirrored in a ref so the flow's onComplete (a closure fixed at runFlow time)
  // reads the LATEST captured value, not the stale null from when the flow started.
  const [creditInput, setCreditInput] = useState<{
    asset: SupportedAsset
    amount: string
  } | null>(null)
  const creditInputRef = useRef<{
    asset: SupportedAsset
    amount: string
  } | null>(null)

  // The reason captured at the ReasonModal step, retained across the remaining steps
  // so onComplete (fired at the final step) can record the maker's justification.
  const [flowReason, setFlowReason] = useState("")

  function runFlow(config: UdFlowConfig) {
    setFlow(config)
    setFlowStep(0)
    setFlowReason("")
  }
  // `reason`, when supplied by the ReasonModal step, is retained; onComplete is
  // called with the retained reason (or the just-supplied one on a reason-only flow).
  function advance(reason?: string) {
    if (!flow) return
    const nextReason = reason !== undefined ? reason : flowReason
    if (reason !== undefined) setFlowReason(reason)
    if (flowStep + 1 >= flow.steps.length) {
      // Completed the last step.
      flow.onComplete?.(nextReason)
      setFlow(null)
      setFlowStep(0)
      return
    }
    setFlowStep(flowStep + 1)
  }
  function cancelFlow() {
    setFlow(null)
    setFlowStep(0)
  }

  const current: UdFlowStep | null = flow ? flow.steps[flowStep] : null

  function openTx(id: string) {
    router.push(`/transactions/${id}`)
  }

  // Fire a sensitive mutation through the step-up-retry wrapper: run it; a 403
  // ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog and stashes the action for
  // replay. Any other failure surfaces a toast (already audited server-side).
  // No UI code moves money here (§3.1) — these mutate identity/KYC/device state only.
  function runStepUpMutation(action: () => Promise<void>, done: string) {
    void stepUp
      .run(action)
      .then((ok) => {
        if (ok) pushToast(done, "ok")
      })
      .catch((error) =>
        pushToast(
          error instanceof ApiError ? error.message : "Action failed",
          "warn"
        )
      )
  }

  // Freeze / Unfreeze — reason, then the step-up-guarded PATCH /admin/users/:id/status.
  const isSuspended = detailQuery.data?.status === "suspended"
  const freezeUser = () => {
    const target = isSuspended ? "active" : "suspended"
    runFlow({
      title: isSuspended ? "Unfreeze account" : "Freeze account",
      steps: ["reason"],
      onComplete: () =>
        runStepUpMutation(
          () =>
            setUserStatus
              .mutateAsync({ id: userId, input: { status: target } })
              .then(() => undefined),
          isSuspended ? "Account reactivated" : "Account frozen"
        ),
    })
  }

  // Approve — reason → confirm (applies immediately after server step-up), then POST
  // /admin/kyc/:id/approve promoting to the submission's requested (verified) tier.
  const approveTier = approveTargetTier(kycQuery.data)
  const kycApprove = () =>
    runFlow({
      title: "Approve KYC",
      steps: ["reason", "maker"],
      diff: [
        { field: "KYC status", from: detailQuery.data?.kycStatus ?? "—", to: "verified" },
        { field: "KYC tier", from: detailQuery.data?.kycTier ?? "—", to: approveTier },
      ],
      onComplete: () =>
        runStepUpMutation(
          () =>
            approveKyc
              .mutateAsync({ userId, input: { tier: approveTier } })
              .then(() => undefined),
          "KYC approved"
        ),
    })
  // Request more info — reason, then the step-up-guarded POST /admin/kyc/:id/request-info.
  const kycInfo = () =>
    runFlow({
      title: "Request more info",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            requestKycInfo.mutateAsync({ userId, reason }).then(() => undefined),
          "Information requested from user"
        ),
    })
  // Reject — reason (required), then POST /admin/kyc/:id/reject with that reason.
  const kycReject = () =>
    runFlow({
      title: "Reject KYC",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            rejectKyc
              .mutateAsync({ userId, input: { reason } })
              .then(() => undefined),
          "KYC rejected"
        ),
    })
  // Override tier — reason → maker (four-eyes, §3.1): raises a `user_tier_override`
  // ChangeRequest a SECOND admin approves (which re-runs the tier-adjust service,
  // server-re-validated §3.3). It does NOT apply immediately — the maker step carries
  // the honest dual-control copy. The reason captured at the reason step is threaded
  // onto the request as the maker's justification.
  const overrideTargetTier = TIER_OVERRIDE_TARGET[detailQuery.data?.kycTier ?? "unverified"]
  const overrideTier = () =>
    runFlow({
      title: "Override tier",
      steps: ["reason", "maker"],
      dualControl: true,
      diff: [
        {
          field: "KYC tier",
          from: detailQuery.data?.kycTier ?? "—",
          to: overrideTargetTier,
        },
      ],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            createChange
              .mutateAsync({
                kind: "user_tier_override",
                resource: `User:${userId}`,
                payload: { userId, tier: overrideTargetTier },
                reason,
              })
              .then(() => undefined),
          "Tier override submitted for approval"
        ),
    })
  // Force re-KYC — reason, then the step-up-guarded POST /admin/users/:id/force-rekyc (§3.4).
  const forceReKycFlow = () =>
    runFlow({
      title: "Force re-KYC",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            forceReKyc.mutateAsync({ id: userId, reason }).then(() => undefined),
          "Re-KYC required from user"
        ),
    })
  // Reset PIN directive — reason, then the step-up-guarded POST /admin/users/:id/pin-reset.
  const resetPin = () =>
    runFlow({
      title: "Reset PIN directive",
      steps: ["reason"],
      onComplete: () =>
        runStepUpMutation(
          () => forcePinReset.mutateAsync(userId).then(() => undefined),
          "PIN reset directive issued"
        ),
    })
  // Revoke-all — reason, then the step-up-guarded DELETE /admin/users/:id/sessions.
  const revokeAll = () =>
    runFlow({
      title: "Revoke all sessions",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            revokeAllUserSessions
              .mutateAsync({ id: userId, reason })
              .then(() => undefined),
          "All sessions revoked"
        ),
    })
  // Unbind a single device — reason, then the step-up-guarded DELETE (per-row id).
  const unbindDevice = (deviceId: string) =>
    runFlow({
      title: "Unbind device",
      steps: ["reason"],
      onComplete: () =>
        runStepUpMutation(
          () =>
            revokeDevice
              .mutateAsync({ id: userId, deviceId })
              .then(() => undefined),
          "Device unbound"
        ),
    })
  // SIM-swap re-verify — reason, then the step-up-guarded POST /admin/users/:id/sim-swap-reverify (§3.4).
  const simSwapReverifyUser = () =>
    runFlow({
      title: "SIM-swap re-verify",
      steps: ["reason"],
      onComplete: () =>
        runStepUpMutation(
          () => simSwapReverify.mutateAsync(userId).then(() => undefined),
          "SIM-swap re-verification triggered"
        ),
    })
  // Manual credit (Phase 7 WRITE, engine-brokered) — MAKER action: raises a pending
  // `manual_credit` request a SECOND admin approves (four-eyes, §3.1). Collects
  // asset + amount (credit step), then reason → engine preview → maker (four-eyes).
  const manualCredit = () => {
    setCreditInput(null)
    creditInputRef.current = null
    runFlow({
      title: "Manual credit",
      steps: ["credit", "reason", "engine", "maker"],
      onComplete: (reason) => {
        const captured = creditInputRef.current
        if (!captured) return
        const { asset, amount } = captured
        runStepUpMutation(
          () =>
            requestManualCredit
              .mutateAsync({ id: userId, input: { asset, amount, reason } })
              .then(() => undefined),
          `Manual credit of ${amount} ${asset} submitted for approval`
        )
      },
    })
  }

  // Add note — the reason modal's free text IS the note body; onComplete POSTs
  // /admin/users/:id/notes (an immutable case note). Step-up-guarded server-side
  // (A5): the write goes through `runStepUpMutation`, so a 403 ADMIN_STEP_UP_REQUIRED
  // opens the StepUpDialog and replays after re-auth.
  const addNote = () =>
    runFlow({
      title: "Add note",
      steps: ["reason"],
      onComplete: (body) =>
        runStepUpMutation(
          () =>
            createUserNote
              .mutateAsync({ id: userId, input: { body } })
              .then(() => undefined),
          "Note added"
        ),
    })

  // Revoke a single END-USER session — reason, then the step-up-guarded DELETE.
  const revokeSession = (sessionId: string) =>
    runFlow({
      title: "Revoke session",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            revokeUserSession
              .mutateAsync({ id: userId, sessionId, reason })
              .then(() => undefined),
          "Session revoked"
        ),
    })

  // Remove a single beneficiary — reason, then the step-up-guarded DELETE.
  const removeBeneficiaryFlow = (beneficiaryId: string) =>
    runFlow({
      title: "Remove beneficiary",
      steps: ["reason"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            removeBeneficiary
              .mutateAsync({ id: beneficiaryId, reason })
              .then(() => undefined),
          "Beneficiary removed"
        ),
    })

  // Resend verification — a low-risk courtesy action: no reason, no step-up.
  const resendUser = () =>
    runStepUpMutation(
      () => resendVerification.mutateAsync({ id: userId }).then(() => undefined),
      "Verification link re-sent"
    )

  // The real step-up's success → replay the stashed mutation, then confirm.
  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok) pushToast("Action recorded", "ok")
      })
      .catch((error) =>
        pushToast(
          error instanceof ApiError ? error.message : "Action failed",
          "warn"
        )
      )
  }

  return {
    router,
    detailQuery,
    kycQuery,
    devicesQuery,
    sessionsQuery,
    limitsQuery,
    limitsCurrency,
    setLimitsCurrency,
    limitsCurrencyOptions,
    timelineQuery,
    notesQuery,
    mfaEnabled: me.data?.mfaEnabled ?? false,
    stepUp,
    tab,
    setTab,
    flow,
    current,
    creditInput,
    setCreditInput,
    creditInputRef,
    advance,
    cancelFlow,
    openTx,
    onStepUpSuccess,
    // Flow builders (header + per-tab actions)
    freezeUser,
    kycApprove,
    kycInfo,
    kycReject,
    overrideTier,
    forceReKycFlow,
    resetPin,
    revokeAll,
    unbindDevice,
    simSwapReverifyUser,
    manualCredit,
    addNote,
    revokeSession,
    removeBeneficiaryFlow,
    resendUser,
    // Derived shown in a flow diff / preview
    approveTier,
  }
}
