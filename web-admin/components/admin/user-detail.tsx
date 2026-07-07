"use client"

/**
 * UserDetail — the Operator Console user-detail screen (design
 * `docs/design-ref/screens/UserDetail.html`), now wired to REAL admin data.
 *
 * Reads (Phase 6a): `useEndUserDetail(userId)` supplies the aggregate that drives
 * the header + Profile / Wallets & balances / Beneficiaries / Transactions tabs;
 * `useKycSubmission(userId)` drives the KYC tab (last-4 PII only — the API never
 * surfaces the full NIN/BVN); `useEndUserDevices(userId)` drives the Devices tab.
 * The design's layout, tokens, spacing, pills and columns are preserved 1:1 —
 * this is wiring, not redesign. Design fields the contract does not provide
 * (phone / locale / on-chain addresses / auth sessions / per-user limits &
 * velocity) render gracefully ("—" / a subtle note) and are recorded as
 * backend-enrichment gaps; those tabs keep the design's own content. Identity
 * PII is last-4 only — the console never reveals a full NIN/BVN (§3.4).
 *
 * Four async branches (loading skeletons / error+retry / empty / data) wrap the
 * aggregate. Write actions (Freeze / Approve-Reject / tier / device revoke /
 * add-note / manual-credit …) still drive the shared flow modals unchanged —
 * wiring them to real mutations is Phase 7. Read-only (§3.1): nothing here moves
 * money; table rows navigate to the transaction-detail route.
 */
import { useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { cn } from "@/lib/utils"
import { formatCrypto, formatCryptoAmount } from "@/lib/format"
import { pushToast } from "@/lib/store/toast-store"
import { ApiError } from "@/lib/api/client"
import { Skeleton } from "@/components/ui/skeleton"
import {
  EngineActionModal,
  MakerCheckerModal,
  ManualCreditModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import {
  useAdjustTier,
  useAdminMe,
  useApproveKyc,
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
import { SupportedAssetSchema } from "@handshake-agent/contracts"
import type { SupportedAsset } from "@handshake-agent/contracts"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  UdTab,
  UserDetailProps,
} from "@/types/components"
import {
  actionDot,
  actionLabel,
  approveTargetTier,
  beneVerificationMeta,
  displayName,
  fmtFiat,
  initialsOf,
  statusMeta,
} from "@/lib/users/user-detail"
import {
  BANK_ICON,
  CRYPTO_ICON,
  KYC_STATUS_META,
  NOT_PROVIDED,
  TABS,
  TIER_OVERRIDE_TARGET,
  TYPE_ICON,
  U_ACTIONS,
} from "@/constants/user-detail"
import { Panel } from "@/components/admin/user-detail/panel"
import {
  UserDetailError,
  UserDetailSkeleton,
} from "@/components/admin/user-detail/shells"
import { LimitsTab } from "@/components/admin/user-detail/limits-tab"

// ── Chat (lines 618-623) ──────────────────────────────────────────────────────────────

const CHAT: readonly {
  text: string
  justify: "flex-start" | "flex-end"
  bg: string
  fg: string
  intent?: string
  proposal?: string
}[] = [
  {
    text: "I want to buy 100 USDT",
    justify: "flex-end",
    bg: "#1a4536",
    fg: "#fff",
  },
  {
    text: "Sure — 100 USDT at ₦1,064.69 = ₦106,469. Fee ₦1,178. Confirm with your PIN?",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
    intent: "crypto.buy",
    proposal: "proposal #p_8841",
  },
  { text: "Confirmed ✅", justify: "flex-end", bg: "#1a4536", fg: "#fff" },
  {
    text: "Done! 100 USDT is in your wallet. [receipt link redacted]",
    justify: "flex-start",
    bg: "var(--card2)",
    fg: "var(--ink)",
  },
]

// ─── Flow-modal orchestration (design runFlow: reason → step-up → engine / maker) ────

type FlowStep = "credit" | "reason" | "stepup" | "engine" | "maker"

interface FlowConfig {
  title: string
  steps: FlowStep[]
  effect?: EngineEffectRow[]
  ledger?: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
  /**
   * Side-effect to run once the flow's final step is confirmed (mutations, toasts).
   * Receives the reason text captured by the ReasonModal step, if any.
   */
  onComplete?: (reason: string) => void
}

export function UserDetail({ userId }: UserDetailProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Real-data reads: the aggregate gates the shell; KYC + devices back their tabs.
  const detailQuery = useEndUserDetail(userId)
  const kycQuery = useKycSubmission(userId)
  const devicesQuery = useEndUserDevices(userId)
  // Per-tab reads (Phase 6b): sessions (Security), limits+velocity (Limits),
  // admin-action timeline (Profile). Each has its own async branches below.
  const sessionsQuery = useEndUserSessions(userId)
  const limitsQuery = useEndUserLimits(userId)
  const timelineQuery = useEndUserTimeline(userId)
  // The user's immutable case notes back the Profile "Notes" list (Phase 9 read).
  const notesQuery = useUserNotes(userId)

  // Sensitive mutations (Phase 7 WRITE) — KYC decisions + account actions (tier /
  // status / pin-reset / device-revoke / sim-swap). Each is step-up-gated: a 403 with
  // code ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog (server re-auth), then the
  // stashed action replays via `stepUp.retry`. The hooks invalidate the KYC queue +
  // the `["admin","users"]` prefix, so this header and the affected tabs re-resolve.
  const me = useAdminMe()
  const approveKyc = useApproveKyc()
  const rejectKyc = useRejectKyc()
  const adjustTier = useAdjustTier()
  const setUserStatus = useSetUserStatus()
  const forcePinReset = useForcePinReset()
  const revokeDevice = useRevokeDevice()
  const simSwapReverify = useSimSwapReverify()
  const requestManualCredit = useRequestManualCredit()
  // Phase 9 WRITE hooks — KYC needs-info / force-re-KYC, end-user session revocation,
  // case notes, beneficiary removal, and the low-risk verification resend.
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
  const [flow, setFlow] = useState<FlowConfig | null>(null)
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
  // so onComplete (fired at the final step) can record the maker's justification —
  // the ReasonModal is rarely the last step, so the reason must persist in state.
  const [flowReason, setFlowReason] = useState("")

  function runFlow(config: FlowConfig) {
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

  const current: FlowStep | null = flow ? flow.steps[flowStep] : null

  function openTx(id: string) {
    router.push(`/transactions/${id}`)
  }

  // ── Write flows (Phase 7) — still drive the shared modals with design copy. ──────────
  // These read/write no real data yet; wiring them to real mutations is a later step.
  // Freeze / Unfreeze — reason → step-up, then PATCH /admin/users/:id/status.
  // Suspends an active account (freeze) or reactivates a suspended one (unfreeze).
  const isSuspended = detailQuery.data?.status === "suspended"
  const freezeUser = () => {
    const target = isSuspended ? "active" : "suspended"
    runFlow({
      title: isSuspended ? "Unfreeze account" : "Freeze account",
      steps: ["reason", "stepup"],
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
  // Fire a sensitive mutation through the step-up-retry wrapper: run it; a 403
  // ADMIN_STEP_UP_REQUIRED opens the real StepUpDialog and stashes the action for
  // replay. Any other failure surfaces a toast (the flow is already audited server-side).
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

  // Approve — reason → step-up → maker-checker (tier 2/3 dual control), then POST
  // /admin/kyc/:id/approve promoting to the submission's requested (verified) tier.
  const approveTier = approveTargetTier(kycQuery.data)
  const kycApprove = () =>
    runFlow({
      title: "Approve KYC",
      steps: ["reason", "stepup", "maker"],
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
  // Request more info — reason → step-up, then POST /admin/kyc/:id/request-info,
  // bouncing the review back to the user with the audited reason (§3.3). Sensitive
  // (may 403 with ADMIN_STEP_UP_REQUIRED — replayed through the step-up dialog).
  const kycInfo = () =>
    runFlow({
      title: "Request more info",
      steps: ["reason", "stepup"],
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
  // Override tier — reason → step-up → maker-checker (dual control), then
  // PATCH /admin/users/:id/tier. The target is a one-step de-escalation of the
  // current tier; the engine re-validates the new tier's limits server-side (§3.3).
  const overrideTargetTier = TIER_OVERRIDE_TARGET[detailQuery.data?.kycTier ?? "unverified"]
  const overrideTier = () =>
    runFlow({
      title: "Override tier · maker-checker",
      steps: ["reason", "stepup", "maker"],
      diff: [
        {
          field: "KYC tier",
          from: detailQuery.data?.kycTier ?? "—",
          to: overrideTargetTier,
        },
      ],
      onComplete: () =>
        runStepUpMutation(
          () =>
            adjustTier
              .mutateAsync({ id: userId, input: { tier: overrideTargetTier } })
              .then(() => undefined),
          "Tier override submitted"
        ),
    })
  // Force re-KYC — reason → step-up, then POST /admin/users/:id/force-rekyc, sending
  // the user back through verification (§3.4). Sensitive (may 403 with step-up).
  const forceReKycFlow = () =>
    runFlow({
      title: "Force re-KYC",
      steps: ["reason", "stepup"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            forceReKyc.mutateAsync({ id: userId, reason }).then(() => undefined),
          "Re-KYC required from user"
        ),
    })
  // Reset PIN directive — reason → step-up, then POST /admin/users/:id/pin-reset.
  const resetPin = () =>
    runFlow({
      title: "Reset PIN directive",
      steps: ["reason", "stepup"],
      onComplete: () =>
        runStepUpMutation(
          () => forcePinReset.mutateAsync(userId).then(() => undefined),
          "PIN reset directive issued"
        ),
    })
  // Revoke-all — reason → step-up, then DELETE /admin/users/:id/sessions (force
  // sign-out of every session). Sensitive (may 403 with step-up). The reason is the
  // audited justification the backend route requires.
  const revokeAll = () =>
    runFlow({
      title: "Revoke all sessions",
      steps: ["reason", "stepup"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            revokeAllUserSessions
              .mutateAsync({ id: userId, reason })
              .then(() => undefined),
          "All sessions revoked"
        ),
    })
  // Unbind a single device — reason → step-up, then DELETE the device (per-row id).
  const unbindDevice = (deviceId: string) =>
    runFlow({
      title: "Unbind device",
      steps: ["reason", "stepup"],
      onComplete: () =>
        runStepUpMutation(
          () =>
            revokeDevice
              .mutateAsync({ id: userId, deviceId })
              .then(() => undefined),
          "Device unbound"
        ),
    })
  // SIM-swap re-verify — reason → step-up, then POST /admin/users/:id/sim-swap-reverify
  // (§3.4: a SIM/number change forces re-verification + step-up before trust is restored).
  const simSwapReverifyUser = () =>
    runFlow({
      title: "SIM-swap re-verify",
      steps: ["reason", "stepup"],
      onComplete: () =>
        runStepUpMutation(
          () => simSwapReverify.mutateAsync(userId).then(() => undefined),
          "SIM-swap re-verification triggered"
        ),
    })
  // Manual credit (Phase 7 WRITE, engine-brokered) — MAKER action: raises a pending
  // `manual_credit` request a SECOND admin approves (four-eyes, §3.1). The flow first
  // collects asset + amount (the `credit` step), then reason → step-up → engine
  // preview → maker-checker; onComplete POSTs /admin/users/:id/credit (moves no money
  // from this surface — the engine credits only on approval). The engine preview +
  // change diff are derived from the captured input, not hardcoded.
  const manualCredit = () => {
    setCreditInput(null)
    creditInputRef.current = null
    runFlow({
      title: "Manual credit",
      steps: ["credit", "reason", "stepup", "engine", "maker"],
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

  // Add note — the reason modal's free text IS the note body; onContinue POSTs
  // /admin/users/:id/notes (an immutable case note). Low-risk (no step-up), but the
  // wrapper still surfaces a 403 as the step-up dialog if the server ever gates it.
  // On success the notes list + timeline invalidate (see the hook) so both re-resolve.
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

  // Revoke a single END-USER session — reason → step-up, then
  // DELETE /admin/users/:id/sessions/:sessionId (per-row id). Sensitive (may 403 with
  // step-up). The reason is the audited justification the backend route requires.
  const revokeSession = (sessionId: string) =>
    runFlow({
      title: "Revoke session",
      steps: ["reason", "stepup"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            revokeUserSession
              .mutateAsync({ id: userId, sessionId, reason })
              .then(() => undefined),
          "Session revoked"
        ),
    })

  // Remove a single beneficiary — reason → step-up, then DELETE
  // /admin/beneficiaries/:id (per-row id). Sensitive (may 403 with step-up); moves no
  // money (§3.1). The reason is the audited justification the backend route requires.
  const removeBeneficiaryFlow = (beneficiaryId: string) =>
    runFlow({
      title: "Remove beneficiary",
      steps: ["reason", "stepup"],
      onComplete: (reason) =>
        runStepUpMutation(
          () =>
            removeBeneficiary
              .mutateAsync({ id: beneficiaryId, reason })
              .then(() => undefined),
          "Beneficiary removed"
        ),
    })

  // Resend verification — a low-risk courtesy action: no reason, no step-up. Fires
  // POST /admin/users/:id/resend-verification directly. Still routed through the
  // step-up wrapper so an unexpected 403 surfaces the re-auth dialog rather than a
  // dead-end error.
  const resendUser = () =>
    runStepUpMutation(
      () =>
        resendVerification
          .mutateAsync({ id: userId })
          .then(() => undefined),
      "Verification link re-sent"
    )

  // ── Async branches for the aggregate that gates the whole screen. ────────────────────
  if (detailQuery.isLoading) {
    return <UserDetailSkeleton />
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <UserDetailError
        onBack={() => router.push("/users")}
        onRetry={() => void detailQuery.refetch()}
      />
    )
  }

  const detail = detailQuery.data
  const kyc = kycQuery.data
  const name = displayName(kyc, detail)
  const initials = initialsOf(name)
  const frozen = detail.status === "suspended"
  const kycMeta = KYC_STATUS_META[detail.kycStatus]
  const simSwapFlagged = detail.simSwapDetectedAt !== null

  // Last-4 PII from the KYC submission — the full value is never sent by the API.
  const ninShown = kyc?.ninLast4 ? "••• ••• ••" + kyc.ninLast4.slice(-2) : "—"
  const bvnShown = kyc?.bvnLast4 ? "••• ••• ••" + kyc.bvnLast4.slice(-2) : "—"

  // Real balances → wallet cards; the design's ≈Total(NGN) tile has no fiat source,
  // so it is only shown when a fiat balance exists (else omitted — see shapeGaps).
  const walletCards = detail.balances.map((b, i) => ({
    label: `${b.asset} · ${b.network}`,
    avail: b.amount,
    pending: b.pending,
    hero: i === 0,
  }))

  // Assets an admin can manually credit: the SUPPORTED assets the user already holds,
  // plus USDT (the launch asset) so a brand-new user can still be credited. Balances
  // whose asset is not a SupportedAsset are dropped (the request DTO only accepts the
  // supported set). The server re-validates against the live catalog on approval
  // (§3.3) — this list is a UX convenience, not the authority.
  const creditableAssets: SupportedAsset[] = Array.from(
    new Set<SupportedAsset>([
      "USDT",
      ...detail.balances
        .map((b) => SupportedAssetSchema.safeParse(b.asset))
        .filter((r) => r.success)
        .map((r) => r.data),
    ])
  )

  // The engine-preview + maker-checker rows for the manual-credit flow, derived from
  // the captured input (never hardcoded). Empty until the credit step is completed.
  const creditAmount = creditInput
    ? formatCrypto(creditInput.amount, creditInput.asset)
    : ""
  const creditEffect: EngineEffectRow[] = creditInput
    ? [
        { k: "Credit to", v: userId },
        { k: "Amount", v: creditAmount },
        { k: "Proposal type", v: "manual_credit" },
      ]
    : []
  const creditLedger: EngineLedgerRow[] = creditInput
    ? [
        { acct: `treasury:${creditInput.asset}`, dir: "DR", amt: creditAmount },
        {
          acct: `${userId}:${creditInput.asset}`,
          dir: "CR",
          amt: creditAmount,
        },
      ]
    : []
  const creditDiff: MakerCheckerDiffRow[] = creditInput
    ? [
        {
          field: `${creditInput.asset} available`,
          from: "—",
          to: `+${creditAmount}`,
        },
      ]
    : []
  const isCreditFlow = flow?.steps[0] === "credit"

  return (
    <div
      data-screen-label="User detail"
      className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]"
    >
      {/* Back-link */}
      <button
        type="button"
        onClick={() => router.push("/users")}
        className="mb-3.5 inline-flex cursor-pointer items-center gap-[7px] text-[12.5px] font-bold text-ink2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 6l-6 6 6 6"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        All users
      </button>

      {/* HEADER */}
      <div className="mb-3.5 rounded-[18px] border border-line bg-card p-[20px_22px]">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="flex size-14 flex-none items-center justify-center rounded-full text-xl font-extrabold text-white"
            style={{ background: "#2a6f55" }}
          >
            {initials}
          </span>
          <div className="min-w-[200px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[21px] font-extrabold tracking-[-0.02em]">
                {name}
              </h1>
              {frozen && (
                <span className="rounded-full bg-sdn px-2.5 py-[3px] text-[11px] font-extrabold text-tdn">
                  FROZEN
                </span>
              )}
              <span
                className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-[11px] font-bold"
                style={{ background: kycMeta.bg, color: kycMeta.fg }}
              >
                {kycMeta.label} · {detail.kycTier}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(detail.id)
                pushToast(`Copied · ${detail.id}`, "copy")
              }}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 font-mono text-xs text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {detail.id}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M9 9h10v10H9zM5 15V5h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
            {/* Flag chips — the SIM-swap risk flag when detected (else an empty row). */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {simSwapFlagged && (
                <span className="rounded-full bg-sdn px-2.5 py-[3px] text-[10.5px] font-extrabold text-tdn">
                  SIM-SWAP
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {U_ACTIONS.map((a) => {
              // Freeze ↔ Unfreeze mirrors the account status; the rest are static.
              const label = a.key === "freeze" && frozen ? "Unfreeze" : a.label
              return (
                <button
                  key={a.key}
                  type="button"
                  title={label}
                  onClick={() => {
                    if (a.key === "freeze") freezeUser()
                    else if (a.key === "note") addNote()
                    else if (a.key === "resend") resendUser()
                  }}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-[7px] rounded-[10px] border px-[13px] text-[12.5px] font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    a.danger
                      ? "border-[#f0d0cb] bg-sdn text-tdn hover:bg-sdn/80"
                      : "border-line bg-card text-ink hover:bg-hov"
                  )}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d={a.icon}
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* TABS (underline) */}
      <div className="scr mb-4 flex gap-[3px] overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex-none cursor-pointer border-b-2 px-[15px] py-2.5 text-[13px] font-bold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-brand-amber text-ink"
                  : "border-transparent text-ink3"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ===== PROFILE ===== */}
      {tab === "profile" && (
        <div className="grid grid-cols-2 gap-3.5">
          <Panel>
            <div className="mb-3 text-[13px] font-extrabold">
              Contact & locale
            </div>
            {[
              { k: "Email", v: detail.email ?? NOT_PROVIDED, mono: false },
              { k: "Phone", v: detail.phone ?? NOT_PROVIDED, mono: true },
              { k: "Country", v: NOT_PROVIDED, mono: false },
              { k: "Locale", v: NOT_PROVIDED, mono: false },
              { k: "Status", v: detail.status, mono: false },
              { k: "Created", v: detail.createdAt, mono: true },
            ].map((c) => (
              <div
                key={c.k}
                className="flex justify-between gap-3 border-b border-line2 py-2"
              >
                <span className="text-[12.5px] text-ink3">{c.k}</span>
                <span
                  className={cn(
                    "text-right text-[12.5px] font-bold capitalize",
                    c.mono && "font-mono"
                  )}
                >
                  {c.v}
                </span>
              </div>
            ))}
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">
                Admin action timeline
              </div>
              <button
                type="button"
                onClick={addNote}
                className="cursor-pointer text-xs font-bold text-tif focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                + Add note
              </button>
            </div>
            {timelineQuery.isLoading && (
              <div className="space-y-3 py-2" aria-busy="true">
                <Skeleton className="h-8 rounded-lg" />
                <Skeleton className="h-8 rounded-lg" />
              </div>
            )}
            {timelineQuery.isError && (
              <div className="flex items-center justify-between gap-3 py-4">
                <span className="text-[12px] font-bold text-tdn">
                  Failed to load the timeline.
                </span>
                <button
                  type="button"
                  onClick={() => void timelineQuery.refetch()}
                  className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Retry
                </button>
              </div>
            )}
            {timelineQuery.isSuccess && timelineQuery.data.length === 0 && (
              <div className="py-6 text-center text-[12px] text-ink3">
                No recorded admin actions for this user.
              </div>
            )}
            {timelineQuery.data?.map((t) => (
              <div
                key={t.id}
                className="flex gap-[11px] border-b border-line2 py-[9px]"
              >
                <span
                  className="mt-[5px] size-2 flex-none rounded-full"
                  style={{ background: actionDot(t.action) }}
                />
                <div className="flex-1">
                  <div className="text-[12.5px] font-semibold capitalize">
                    {actionLabel(t.action)}
                  </div>
                  <div className="text-[11px] text-ink3">
                    {t.actor} · {t.createdAt}
                  </div>
                </div>
              </div>
            ))}

            {/* Case notes — the immutable free-text notes appended via "Add note"
                (POST /admin/users/:id/notes). Its own four async branches. */}
            <div className="mt-4 mb-2.5 text-xs font-extrabold text-ink2">
              Case notes
            </div>
            {notesQuery.isLoading && (
              <div className="space-y-3 py-2" aria-busy="true">
                <Skeleton className="h-8 rounded-lg" />
              </div>
            )}
            {notesQuery.isError && (
              <div className="flex items-center justify-between gap-3 py-4">
                <span className="text-[12px] font-bold text-tdn">
                  Failed to load case notes.
                </span>
                <button
                  type="button"
                  onClick={() => void notesQuery.refetch()}
                  className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Retry
                </button>
              </div>
            )}
            {notesQuery.isSuccess && notesQuery.data.items.length === 0 && (
              <div className="py-4 text-center text-[12px] text-ink3">
                No case notes for this user.
              </div>
            )}
            {notesQuery.data?.items.map((n) => (
              <div
                key={n.id}
                className="flex gap-[11px] border-b border-line2 py-[9px]"
              >
                <span className="mt-[5px] size-2 flex-none rounded-full bg-[#8b948a]" />
                <div className="flex-1">
                  <div className="text-[12.5px] whitespace-pre-wrap">
                    {n.body}
                  </div>
                  <div className="text-[11px] text-ink3">
                    {n.authorAdminId} · {n.createdAt}
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== KYC ===== */}
      {tab === "kyc" && (
        <div className="grid grid-cols-[1.3fr_1fr] items-start gap-3.5">
          <div className="flex flex-col gap-3.5">
            <Panel>
              <div className="mb-3 text-[13px] font-extrabold">
                Identity documents
              </div>
              <div className="flex flex-col gap-2.5">
                {/* NIN */}
                <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
                  <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="14"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M3 9h18"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-ink3">NIN</div>
                    <div className="font-mono text-[15px] font-bold">
                      {ninShown}
                    </div>
                  </div>
                  {/* Last-4 only — the full NIN is never fetched or revealed (§3.4). */}
                  <span className="rounded-full bg-sok px-2.5 py-[5px] text-[11px] font-bold text-tok">
                    Encrypted at rest
                  </span>
                </div>
                {/* BVN */}
                <div className="flex items-center gap-[13px] rounded-xl border border-line p-[12px_14px]">
                  <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <rect
                        x="3"
                        y="5"
                        width="18"
                        height="14"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <circle
                        cx="8.5"
                        cy="11"
                        r="2"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M13 10h5M13 14H7"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-ink3">BVN</div>
                    <div className="font-mono text-[15px] font-bold">
                      {bvnShown}
                    </div>
                  </div>
                  <span className="rounded-full bg-sok px-2.5 py-[5px] text-[11px] font-bold text-tok">
                    Encrypted at rest
                  </span>
                </div>
                {/* ID + selfie placeholders */}
                <div className="flex gap-2.5">
                  <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
                    <span className="font-mono text-[10px] text-ink3">
                      ID_FRONT.jpg
                    </span>
                  </div>
                  <div className="flex h-24 flex-1 items-end justify-center rounded-xl border border-line bg-[repeating-linear-gradient(45deg,var(--card2)_0_7px,var(--card)_7px_14px)] pb-2">
                    <span className="font-mono text-[10px] text-ink3">
                      SELFIE.jpg
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
            <Panel>
              <div className="mb-2.5 text-[13px] font-extrabold">
                Liveness & document
              </div>
              <div className="flex items-center gap-[11px] rounded-xl bg-sok p-[11px_13px]">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                  className="text-tok"
                >
                  <path
                    d="m5 12 5 5L20 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div>
                  <div className="text-[12.5px] font-bold text-tok">
                    Liveness · {kyc?.livenessResult ?? NOT_PROVIDED}
                  </div>
                  <div className="text-[11.5px] text-ink2">
                    Identity document: {kyc?.idDocumentType ?? NOT_PROVIDED}.
                  </div>
                </div>
              </div>
            </Panel>
          </div>
          <Panel>
            <div className="mb-1 text-[13px] font-extrabold">
              Review decision
            </div>
            <div className="mb-3.5 text-xs text-ink2">
              Decisions are audited. Tier 2/3 require a second approver.
            </div>
            <div className="flex flex-col gap-[9px]">
              <button
                type="button"
                onClick={kycApprove}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-[11px] bg-[#1f8a5b] p-3 text-[13.5px] font-extrabold text-white focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="m5 12 5 5L20 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Approve · {approveTier} (maker-checker)
              </button>
              <div className="flex gap-[9px]">
                <button
                  type="button"
                  onClick={kycInfo}
                  className="flex-1 cursor-pointer rounded-[11px] border border-line p-[11px] text-center text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Request info
                </button>
                <button
                  type="button"
                  onClick={kycReject}
                  className="flex-1 cursor-pointer rounded-[11px] border border-[#f0d0cb] p-[11px] text-center text-[12.5px] font-bold text-tdn transition-colors hover:bg-sdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Reject
                </button>
              </div>
            </div>
            <div className="my-4 h-px bg-line2" />
            <div className="mb-[9px] text-xs font-extrabold">Tier controls</div>
            <button
              type="button"
              onClick={overrideTier}
              className="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 3l2.5 6H21l-5 4 2 7-6-4-6 4 2-7-5-4h6.5z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
              Override tier · maker-checker
            </button>
            <button
              type="button"
              onClick={forceReKycFlow}
              className="flex w-full cursor-pointer items-center gap-2 rounded-[10px] border border-line p-[10px_12px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Force re-KYC
            </button>
          </Panel>
        </div>
      )}

      {/* ===== DEVICES ===== */}
      {tab === "devices" && (
        <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
          {devicesQuery.isLoading && (
            <div className="space-y-3 py-4" aria-busy="true">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          )}
          {devicesQuery.isError && (
            <div className="flex items-center justify-between gap-3 py-6">
              <span className="text-[12.5px] font-bold text-tdn">
                Failed to load devices.
              </span>
              <button
                type="button"
                onClick={() => void devicesQuery.refetch()}
                className="cursor-pointer rounded-[9px] border border-line px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Retry
              </button>
            </div>
          )}
          {devicesQuery.isSuccess && devicesQuery.data.length === 0 && (
            <div className="py-8 text-center text-[12.5px] text-ink3">
              No bound devices for this user.
            </div>
          )}
          {devicesQuery.data?.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3.5 border-b border-line2 py-4"
            >
              <span className="flex size-[42px] flex-none items-center justify-center rounded-[11px] bg-card2 text-ink2">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <rect
                    x="6"
                    y="2.5"
                    width="12"
                    height="19"
                    rx="2.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M10.5 18.5h3"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[13.5px] font-bold capitalize">
                  {d.trustState} device
                  {d.isPinned && (
                    <span className="rounded-full bg-sok px-2 py-[2px] text-[10px] font-bold text-tok">
                      Pinned
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11.5px] text-ink3">
                  {d.id} · last seen {d.lastUsedAt ?? NOT_PROVIDED}
                </div>
              </div>
              {simSwapFlagged && (
                <span className="rounded-full bg-sdn px-2.5 py-1 text-[10.5px] font-extrabold text-tdn">
                  SIM-SWAP
                </span>
              )}
              {simSwapFlagged && (
                <button
                  type="button"
                  onClick={simSwapReverifyUser}
                  className="cursor-pointer rounded-[9px] border border-[#f0d0cb] bg-sdn px-[13px] py-2 text-xs font-bold text-tdn transition-colors hover:bg-sdn/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  SIM-swap re-verify
                </button>
              )}
              <button
                type="button"
                onClick={() => unbindDevice(d.id)}
                className="cursor-pointer rounded-[9px] border border-line px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Unbind
              </button>
            </div>
          ))}
          <div className="flex items-center gap-[9px] py-3.5 text-xs text-ink3">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M7 11V8a5 5 0 0 1 10 0v3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <rect
                x="5"
                y="11"
                width="14"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
            Identity = verified KYC + bound device + PIN. A phone number alone
            never authenticates a session.
          </div>
        </div>
      )}

      {/* ===== SECURITY ===== */}
      {tab === "security" && (
        <div className="grid grid-cols-2 items-start gap-3.5">
          <Panel>
            <div className="mb-3 text-[13px] font-extrabold">
              PIN & authentication
            </div>
            {/* PIN-set time / lockout counts / 2FA state are not projected by any
                read endpoint yet (see shapeGaps) — the reset directive below is
                the live action; the status rows stay a documented gap. */}
            <div className="py-4 text-center text-[12px] text-ink3">
              PIN status, lockout counters, and 2FA state are not yet surfaced in
              this view.
            </div>
            <button
              type="button"
              onClick={resetPin}
              className="mt-3.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[11px] border border-line p-[11px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden
              >
                <path
                  d="M4 12a8 8 0 1 1 2.3 5.6M4 20v-4h4"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Reset PIN directive · step-up
            </button>
          </Panel>
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">Active sessions</div>
              <button
                type="button"
                onClick={revokeAll}
                className="cursor-pointer text-xs font-bold text-tdn focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Revoke all
              </button>
            </div>
            {sessionsQuery.isLoading && (
              <div className="space-y-3 py-2" aria-busy="true">
                <Skeleton className="h-9 rounded-lg" />
                <Skeleton className="h-9 rounded-lg" />
              </div>
            )}
            {sessionsQuery.isError && (
              <div className="flex items-center justify-between gap-3 py-4">
                <span className="text-[12px] font-bold text-tdn">
                  Failed to load sessions.
                </span>
                <button
                  type="button"
                  onClick={() => void sessionsQuery.refetch()}
                  className="cursor-pointer rounded-[9px] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Retry
                </button>
              </div>
            )}
            {sessionsQuery.isSuccess && sessionsQuery.data.length === 0 && (
              <div className="py-6 text-center text-[12px] text-ink3">
                No active or recent sessions.
              </div>
            )}
            {sessionsQuery.data?.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-[11px] border-b border-line2 py-2.5"
              >
                <span
                  className="size-2 flex-none rounded-full"
                  style={{ background: s.isActive ? "#1f8a5b" : "#8b948a" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold">
                    {s.userAgent ?? s.channel}
                    {!s.isActive && (
                      <span className="ml-1.5 text-[10.5px] font-bold text-ink3">
                        · ended
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-ink3">
                    {(s.ipAddress ?? "—") + " · " + (s.lastActivityAt ?? s.issuedAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeSession(s.id)}
                  disabled={!s.isActive}
                  className="cursor-pointer text-[11.5px] font-bold text-ink2 disabled:cursor-default disabled:opacity-40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Revoke
                </button>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {/* ===== WALLETS ===== */}
      {tab === "wallets" && (
        <div className="flex flex-col gap-3.5">
          {walletCards.length === 0 ? (
            <div className="rounded-2xl border border-line bg-card px-[18px] py-8 text-center text-[12.5px] text-ink3">
              No wallet balances for this user.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {walletCards.map((w) => (
                <div
                  key={w.label}
                  className="rounded-2xl border p-[16px_18px]"
                  style={{
                    background: w.hero
                      ? "linear-gradient(150deg,#1a4536,#0e241c)"
                      : "var(--card)",
                    borderColor: w.hero ? "transparent" : "var(--line)",
                    color: w.hero ? "#fff" : "var(--ink)",
                  }}
                >
                  <div
                    className="text-xs font-semibold"
                    style={{
                      color: w.hero ? "rgba(214,226,219,0.65)" : "var(--ink3)",
                    }}
                  >
                    {w.label}
                  </div>
                  <div className="mt-[5px] font-mono text-[22px] font-extrabold tabular-nums">
                    {formatCryptoAmount(w.avail)}
                  </div>
                  <div
                    className="mt-[3px] text-[11.5px] tabular-nums"
                    style={{
                      color: w.hero ? "rgba(214,226,219,0.65)" : "var(--ink3)",
                    }}
                  >
                    available
                    {w.pending !== null && (
                      <span className="ml-1.5">
                        · {formatCryptoAmount(w.pending)} pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[13px] font-extrabold">
                On-chain deposit addresses{" "}
                <span className="font-semibold text-ink3">
                  · child addresses
                </span>
              </div>
              <button
                type="button"
                onClick={manualCredit}
                className="flex cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[13px] py-2 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Manual credit
              </button>
            </div>
            {/* Real per-network child deposit addresses from the aggregate. */}
            {detail.depositAddresses.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-ink3">
                No provisioned deposit addresses yet.
              </div>
            ) : (
              detail.depositAddresses.map((a) => (
                <button
                  key={a.network + a.address}
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(a.address)
                    pushToast(`Copied · ${a.address}`, "copy")
                  }}
                  className="flex w-full items-center gap-3 border-b border-line2 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="rounded-md bg-card2 px-2 py-[3px] text-[10.5px] font-bold text-ink2">
                    {a.network}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                    {a.address}
                  </span>
                  <span className="text-[10.5px] font-bold text-ink3 capitalize">
                    {a.status}
                  </span>
                </button>
              ))
            )}
          </Panel>
        </div>
      )}

      {/* ===== BENEFICIARIES ===== */}
      {tab === "bene" && (
        <div className="rounded-2xl border border-line bg-card p-[6px_20px]">
          {detail.beneficiaries.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-ink3">
              No saved beneficiaries.
            </div>
          ) : (
            detail.beneficiaries.map((b) => {
              const ne = beneVerificationMeta(b.verificationStatus)
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-[13px] border-b border-line2 py-[15px]"
                >
                  <span className="flex size-[38px] flex-none items-center justify-center rounded-[10px] bg-card2 text-ink2">
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d={b.type === "bank_account" ? BANK_ICON : CRYPTO_ICON}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{b.label}</div>
                    <div className="font-mono text-[11.5px] text-ink3 capitalize">
                      {b.type.replace(/_/g, " ")}
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                    style={{ background: ne.bg, color: ne.fg }}
                  >
                    {ne.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeBeneficiaryFlow(b.id)}
                    className="cursor-pointer text-[11.5px] font-bold text-ink3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    Remove
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ===== TRANSACTIONS ===== */}
      {tab === "tx" && (
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          {detail.recentTransactions.length === 0 ? (
            <div className="py-8 text-center text-[12.5px] text-ink3">
              No transactions for this user.
            </div>
          ) : (
            detail.recentTransactions.map((t) => {
              const sm = statusMeta(t.status)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTx(t.id)}
                  className="grid w-full cursor-pointer grid-cols-[1.2fr_1fr_1fr_1fr] items-center gap-3 border-b border-line2 p-[13px_18px] text-left transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex items-center gap-[9px]">
                    <span className="flex size-[30px] flex-none items-center justify-center rounded-lg bg-card2 text-ink2">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden
                      >
                        <path
                          d={TYPE_ICON[t.type] ?? TYPE_ICON.buy}
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <div>
                      <div className="text-[12.5px] font-bold capitalize">
                        {t.type}
                      </div>
                      <div className="font-mono text-[10.5px] text-ink3">
                        {t.id}
                      </div>
                    </div>
                  </div>
                  {/* Amount (crypto leg) + NGN fiat leg projected from metadata. */}
                  <div className="font-mono text-[12.5px] font-bold tabular-nums">
                    {t.amount !== null ? (
                      <>
                        {formatCryptoAmount(t.amount)}
                        {t.asset && (
                          <span className="ml-1 text-[10.5px] text-ink3">
                            {t.asset}
                          </span>
                        )}
                        <div className="text-[10.5px] font-semibold text-ink3">
                          {fmtFiat(t.fiatAmount, t.fiatCurrency)}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink3">{NOT_PROVIDED}</span>
                    )}
                  </div>
                  <div className="text-xs text-ink2 tabular-nums">
                    {t.createdAt}
                  </div>
                  <div>
                    <span
                      className="rounded-full px-[9px] py-[3px] text-[10.5px] font-bold capitalize"
                      style={{ background: sm.bg, color: sm.fg }}
                    >
                      {sm.l}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}

      {/* ===== CHAT ===== */}
      {tab === "chat" && (
        <div className="max-w-[720px] rounded-2xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-[9px] text-xs text-ink3">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M7 11V8a5 5 0 0 1 10 0v3"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <rect
                x="5"
                y="11"
                width="14"
                height="9"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
            Read-only transcript · secrets redacted · WhatsApp + web
          </div>
          {CHAT.map((m, i) => (
            <div
              key={i}
              className="mb-3 flex"
              style={{ justifyContent: m.justify }}
            >
              <div className="max-w-[75%]">
                <div
                  className="rounded-[14px] p-[10px_13px] text-[13px] leading-[1.45]"
                  style={{ background: m.bg, color: m.fg }}
                >
                  {m.text}
                </div>
                {m.intent && (
                  <div className="mt-[5px] inline-flex items-center gap-1.5 rounded-full bg-sif px-[9px] py-[3px] text-[10.5px] font-bold text-tif">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                    </svg>
                    intent: {m.intent} → {m.proposal}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===== LIMITS ===== */}
      {tab === "limits" && (
        <LimitsTab
          tier={detail.kycTier}
          query={limitsQuery}
          onRetry={() => void limitsQuery.refetch()}
        />
      )}

      {/* ===== FLOW MODALS (credit → reason → step-up → engine / maker) ===== */}
      <ManualCreditModal
        open={current === "credit"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? "Manual credit"}
        assets={creditableAssets}
        onContinue={(asset, amount) => {
          // `asset` is one of `creditableAssets` (all SupportedAsset); parse to
          // narrow the type — falls back to USDT if somehow off-list (never fires).
          const parsed = SupportedAssetSchema.safeParse(asset)
          const input = {
            asset: parsed.success ? parsed.data : ("USDT" as SupportedAsset),
            amount,
          }
          setCreditInput(input)
          creditInputRef.current = input
          advance()
        }}
      />
      <ReasonModal
        open={current === "reason"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        onContinue={(reason) => advance(reason)}
      />
      <StepUpModal
        open={current === "stepup"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        onComplete={() => advance()}
      />
      <EngineActionModal
        open={current === "engine"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        effect={isCreditFlow ? creditEffect : (flow?.effect ?? [])}
        ledger={isCreditFlow ? creditLedger : (flow?.ledger ?? [])}
        idempotencyKey="idem_9f31c0a2"
        cta="Execute via engine"
        onExecute={() => advance()}
      />
      <MakerCheckerModal
        open={current === "maker"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        diff={isCreditFlow ? creditDiff : (flow?.diff ?? [])}
        onSubmit={() => advance()}
      />

      {/* Server-driven step-up: a sensitive mutation that 403s with
          ADMIN_STEP_UP_REQUIRED opens this re-auth dialog; on success the stashed
          mutation replays. Shared by every KYC + account action on this screen. */}
      <StepUpDialog
        open={stepUp.open}
        mfaEnabled={me.data?.mfaEnabled ?? false}
        onOpenChange={stepUp.setOpen}
        onSuccess={() => {
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
        }}
      />
    </div>
  )
}
