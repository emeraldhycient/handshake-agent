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
 * velocity / full-PII reveal) render gracefully ("—" / a subtle note) and are
 * recorded as backend-enrichment gaps; those tabs keep the design's own content.
 *
 * Four async branches (loading skeletons / error+retry / empty / data) wrap the
 * aggregate. Write actions (Freeze / Approve-Reject / tier / device revoke /
 * add-note / manual-credit …) still drive the shared flow modals unchanged —
 * wiring them to real mutations is Phase 7. Read-only (§3.1): nothing here moves
 * money; table rows navigate to the transaction-detail route.
 */
import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import { Skeleton } from "@/components/ui/skeleton"
import {
  EngineActionModal,
  MakerCheckerModal,
  PiiRevealModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import {
  useEndUserDetail,
  useEndUserDevices,
  useEndUserLimits,
  useEndUserSessions,
  useEndUserTimeline,
  useKycSubmission,
} from "@/lib/query/hooks"
import type {
  AdminEndUserDetail,
  AdminEndUserLimitsResponse,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  UserDetailProps,
} from "@/types/components"

// ─── Real-data field mapping helpers ────────────────────────────────────────────────

const NOT_PROVIDED = "—"

/** Display name from KYC identity, falling back to the email local-part, then id. */
function displayName(
  kyc: KycSubmissionDetail | undefined,
  detail: AdminEndUserDetail
): string {
  const full = [kyc?.firstName, kyc?.lastName].filter(Boolean).join(" ").trim()
  if (full) return full
  if (detail.email) return detail.email.split("@")[0]
  return detail.id
}

/** Two-letter avatar initials from the display name (design shows a monogram). */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")
  return letters.toUpperCase() || "?"
}

/** KYC status → design pill { label, bg-token, fg-token } (vUserDetail kycMeta). */
const KYC_STATUS_META: Record<
  AdminEndUserDetail["kycStatus"],
  { label: string; bg: string; fg: string }
> = {
  not_started: { label: "Not started", bg: "var(--card2)", fg: "var(--ink2)" },
  pending: { label: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  pending_review: { label: "In review", bg: "var(--swn)", fg: "var(--twn)" },
  verified: { label: "Verified", bg: "var(--sok)", fg: "var(--tok)" },
  rejected: { label: "Rejected", bg: "var(--sdn)", fg: "var(--tdn)" },
  expired: { label: "Expired", bg: "var(--sdn)", fg: "var(--tdn)" },
}

/** Beneficiary verification status → the design's name-enquiry pill tokens. */
function beneVerificationMeta(status: string): {
  label: string
  bg: string
  fg: string
} {
  const s = status.toLowerCase()
  if (s.includes("verif") || s.includes("match"))
    return { label: "Name match", bg: "var(--sok)", fg: "var(--tok)" }
  if (s.includes("reject") || s.includes("fail"))
    return { label: "Mismatch", bg: "var(--sdn)", fg: "var(--tdn)" }
  return { label: "Unverified", bg: "var(--swn)", fg: "var(--twn)" }
}

const BANK_ICON = "M4 9h16M6 9v9M18 9v9M3 21h18M12 3l8 6H4z"
const CRYPTO_ICON = "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 12h6"

type Tab =
  | "profile"
  | "kyc"
  | "devices"
  | "security"
  | "wallets"
  | "bene"
  | "tx"
  | "chat"
  | "limits"

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "kyc", label: "KYC" },
  { id: "devices", label: "Devices" },
  { id: "security", label: "Security" },
  { id: "wallets", label: "Wallets & balances" },
  { id: "bene", label: "Beneficiaries" },
  { id: "tx", label: "Transactions" },
  { id: "chat", label: "Chat history" },
  { id: "limits", label: "Limits" },
]

/** Header action buttons (vUserDetail uActions, line 584). */
const U_ACTIONS: readonly { label: string; icon: string; danger?: boolean }[] =
  [
    {
      label: "Freeze",
      icon: "M6 10V8a6 6 0 0 1 12 0v2M5 10h14v10H5z",
      danger: true,
    },
    { label: "Add note", icon: "M12 5v14M5 12h14" },
    { label: "Resend", icon: "M4 4h16v12H8l-4 4z" },
    {
      label: "View as",
      icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
    },
  ]

// The Profile admin-action timeline, Security auth-sessions, and Limits/velocity
// are now backed by real read endpoints (useEndUserTimeline / useEndUserSessions /
// useEndUserLimits) — the former design-mock consts were removed.

// A human action label from the audit-log action key (e.g. "kyc_state_change").
function actionLabel(action: string): string {
  return action.replace(/_/g, " ")
}

// Timeline dot tint by action family — deterministic, no color-only signalling.
function actionDot(action: string): string {
  if (action.includes("reject") || action.includes("block")) return "#c0563f"
  if (action.includes("override") || action.includes("reset")) return "#f5a623"
  return "#8b948a"
}

// ── Transactions — icon + status pill maps (rows come from the real aggregate) ────────

const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  receive: "M12 4v13l-4-4M12 17l4-4",
  ticket: "M4 9h16v6H4z",
}

const ST_META: Record<string, { l: string; bg: string; fg: string }> = {
  settled: { l: "Settled", bg: "var(--sok)", fg: "var(--tok)" },
  completed: { l: "Settled", bg: "var(--sok)", fg: "var(--tok)" },
  pending_settlement: { l: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  pending: { l: "Pending", bg: "var(--swn)", fg: "var(--twn)" },
  failed: { l: "Failed", bg: "var(--sdn)", fg: "var(--tdn)" },
  refunded: { l: "Refunded", bg: "var(--sif)", fg: "var(--tif)" },
}

/** Status → pill meta, tolerant of unknown engine statuses (design has no fallback). */
function statusMeta(status: string): { l: string; bg: string; fg: string } {
  return (
    ST_META[status] ?? {
      l: status.replace(/_/g, " "),
      bg: "var(--card2)",
      fg: "var(--ink2)",
    }
  )
}

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

// ── Limits & velocity money formatting (rows come from useEndUserLimits) ─────────────

/** Formats a decimal-string fiat amount with grouping + the currency symbol. */
function fmtFiat(amount: string | null, currency: string | null): string {
  if (amount === null) return NOT_PROVIDED
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  const symbol = currency === "NGN" ? "₦" : currency ? `${currency} ` : ""
  return symbol + n.toLocaleString("en-NG", { maximumFractionDigits: 2 })
}

/** Used/cap → a clamped 0–100% width string for the velocity bar. */
function usagePct(used: string, cap: string): string {
  const u = Number(used)
  const c = Number(cap)
  if (!Number.isFinite(u) || !Number.isFinite(c) || c <= 0) return "0%"
  return Math.min(100, Math.max(0, Math.round((u / c) * 100))) + "%"
}

/** Bar tint by usage band — amber past 75%, red past 90% (never color-only). */
function usageBar(pct: string): string {
  const v = parseInt(pct, 10)
  if (v >= 90) return "#c0563f"
  if (v >= 75) return "#f5a623"
  return "#1a4536"
}

// ─── Small presentational helper: the design card/panel ─────────────────────────────

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}

// ─── Flow-modal orchestration (design runFlow: reason → step-up → engine / maker) ────

type FlowStep = "reason" | "stepup" | "engine" | "maker" | "pii"

interface FlowConfig {
  title: string
  steps: FlowStep[]
  effect?: EngineEffectRow[]
  ledger?: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
  piiLabel?: string
  /** When the flow completes, reveal decrypted PII (the reveal-NIN flow). */
  reveals?: boolean
  /**
   * Side-effect to run once the flow's final step is confirmed (mutations, toasts).
   * Receives the reason text captured by the ReasonModal step, if any.
   */
  onComplete?: (reason: string) => void
}

// ─── Loading / error shells (four-branch async, matching the design frame) ───────────

function UserDetailShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]">
      {children}
    </div>
  )
}

function UserDetailSkeleton() {
  return (
    <UserDetailShell>
      <Skeleton className="mb-3.5 h-4 w-24" />
      <div className="mb-3.5 rounded-[18px] border border-line bg-card p-[20px_22px]">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
      </div>
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-8 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </UserDetailShell>
  )
}

function UserDetailError({
  onBack,
  onRetry,
}: {
  onBack: () => void
  onRetry: () => void
}) {
  return (
    <UserDetailShell>
      <button
        type="button"
        onClick={onBack}
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
      <div className="rounded-[18px] border border-sdn bg-sdn/40 p-6 text-center">
        <p className="text-sm font-bold text-tdn">Failed to load user</p>
        <p className="mt-1 text-[12.5px] text-ink2">
          The user aggregate could not be fetched.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3.5 cursor-pointer rounded-[10px] border border-line bg-card px-[15px] py-2 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    </UserDetailShell>
  )
}

// ─── Limits tab: effective caps + live velocity usage (useEndUserLimits) ─────────────

/** The subset of the useEndUserLimits query result the Limits tab reads. */
interface LimitsQueryLike {
  isLoading: boolean
  isError: boolean
  data: AdminEndUserLimitsResponse | undefined
}

function LimitsTab({
  tier,
  query,
  onRetry,
}: {
  tier: string
  query: LimitsQueryLike
  onRetry: () => void
}) {
  if (query.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3.5" aria-busy="true">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-sdn bg-sdn/40 p-5">
        <span className="text-[12.5px] font-bold text-tdn">
          Failed to load limits & velocity.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-[9px] border border-line bg-card px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  const { effectiveLimits, velocity } = query.data
  const fiat = effectiveLimits?.fiatCurrency ?? null

  // Effective-cap rows — null when the user is unverified (no tier caps apply).
  const limitRows = effectiveLimits
    ? [
        {
          k: "Per-transaction cap",
          v: fmtFiat(effectiveLimits.perTxFiatMax, fiat),
        },
        { k: "Daily cap", v: fmtFiat(effectiveLimits.dailyFiatMax, fiat) },
        {
          k: "Tx count / day",
          v: String(effectiveLimits.dailyTxCountMax),
        },
      ]
    : []

  // Velocity rows — fiat used vs daily cap, and tx count vs daily count cap.
  const fiatPct = effectiveLimits
    ? usagePct(velocity.dailyFiatUsed, effectiveLimits.dailyFiatMax)
    : "0%"
  const countPct = effectiveLimits
    ? usagePct(
        String(velocity.dailyTxCount),
        String(effectiveLimits.dailyTxCountMax)
      )
    : "0%"

  return (
    <div className="grid grid-cols-2 items-start gap-3.5">
      <Panel>
        <div className="mb-1 text-[13px] font-extrabold">
          Effective limits · {tier}
        </div>
        <div className="mb-3.5 text-[11.5px] text-ink3">
          Per-tier caps resolved from the layered config.
        </div>
        {limitRows.length === 0 ? (
          <div className="py-4 text-center text-[12px] text-ink3">
            No tier caps apply — this user is unverified.
          </div>
        ) : (
          limitRows.map((l) => (
            <div
              key={l.k}
              className="flex justify-between gap-3 border-b border-line2 py-[9px]"
            >
              <span className="text-[12.5px] text-ink2">{l.k}</span>
              <span className="font-mono text-[12.5px] font-bold tabular-nums">
                {l.v}
              </span>
            </div>
          ))
        )}
      </Panel>
      <Panel>
        <div className="mb-3.5 text-[13px] font-extrabold">
          Current velocity usage
        </div>
        <VelocityBar
          label="Daily fiat used"
          used={fmtFiat(velocity.dailyFiatUsed, fiat)}
          cap={
            effectiveLimits ? fmtFiat(effectiveLimits.dailyFiatMax, fiat) : "—"
          }
          pct={fiatPct}
        />
        <VelocityBar
          label="Tx count (24h)"
          used={String(velocity.dailyTxCount)}
          cap={effectiveLimits ? String(effectiveLimits.dailyTxCountMax) : "—"}
          pct={countPct}
        />
      </Panel>
    </div>
  )
}

/** One labelled velocity bar (used / cap + a clamped progress track). */
function VelocityBar({
  label,
  used,
  cap,
  pct,
}: {
  label: string
  used: string
  cap: string
  pct: string
}) {
  return (
    <div className="mb-[15px]">
      <div className="mb-1.5 flex justify-between">
        <span className="text-xs font-semibold text-ink2">{label}</span>
        <span className="font-mono text-[11.5px] font-bold text-ink2 tabular-nums">
          {used} / {cap}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-md bg-card2">
        <div
          className="h-full rounded-md"
          style={{ width: pct, background: usageBar(pct) }}
        />
      </div>
    </div>
  )
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

  // Deep-link tab: seed from ?tab= when it names a valid tab (KYC-queue links land on KYC).
  const [tab, setTab] = useState<Tab>(() => {
    const q = searchParams.get("tab")
    return TABS.some((t) => t.id === q) ? (q as Tab) : "profile"
  })
  const [piiRevealed, setPiiRevealed] = useState(false)

  // Sequential flow-modal machine: the active step index walks the config's steps.
  const [flow, setFlow] = useState<FlowConfig | null>(null)
  const [flowStep, setFlowStep] = useState(0)

  function runFlow(config: FlowConfig) {
    setFlow(config)
    setFlowStep(0)
  }
  // `reason` is forwarded from the ReasonModal step so onComplete can record it.
  function advance(reason = "") {
    if (!flow) return
    if (flowStep + 1 >= flow.steps.length) {
      // Completed the last step.
      if (flow.reveals) setPiiRevealed(true)
      flow.onComplete?.(reason)
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
  const freezeUser = () =>
    runFlow({ title: "Freeze account", steps: ["reason", "stepup"] })
  const revealNin = () => {
    // The API only ever surfaces the last-4 (PII minimization), so "reveal" toggles a
    // logged-access banner — the full NIN/BVN is never fetched. See shapeGaps.
    if (piiRevealed) {
      setPiiRevealed(false)
      return
    }
    runFlow({
      title: "Reveal NIN",
      steps: ["pii", "stepup"],
      piiLabel: "NIN & BVN",
      reveals: true,
    })
  }
  const kycApprove = () =>
    runFlow({
      title: "Approve KYC",
      steps: ["reason", "stepup", "maker"],
      diff: [{ field: "KYC status", from: "pending", to: "verified" }],
    })
  const kycInfo = () =>
    runFlow({ title: "Request more info", steps: ["reason"] })
  const kycReject = () => runFlow({ title: "Reject KYC", steps: ["reason"] })
  const overrideTier = () =>
    runFlow({
      title: "Override tier · maker-checker",
      steps: ["reason", "stepup", "maker"],
      diff: [{ field: "KYC tier", from: "tier_3", to: "tier_2" }],
    })
  const forceReKyc = () =>
    runFlow({ title: "Force re-KYC", steps: ["reason", "stepup"] })
  const resetPin = () =>
    runFlow({ title: "Reset PIN directive", steps: ["reason", "stepup"] })
  const revokeAll = () =>
    runFlow({ title: "Revoke all sessions", steps: ["stepup"] })
  const unbindDevice = () =>
    runFlow({ title: "Unbind device", steps: ["reason", "stepup"] })
  const manualCredit = () =>
    runFlow({
      title: "Manual credit · 25.00 USDT",
      steps: ["reason", "stepup", "engine", "maker"],
      effect: [
        { k: "Credit to", v: userId },
        { k: "Amount", v: "25.000000 USDT" },
        { k: "Proposal type", v: "manual_credit" },
      ],
      ledger: [
        { acct: "treasury:USDT", dir: "DR", amt: "25.000000" },
        { acct: `${userId}:USDT`, dir: "CR", amt: "25.000000" },
      ],
      diff: [{ field: "USDT available", from: "—", to: "+25.00 USDT" }],
    })

  // Add note — the timeline is now a read-only projection of the audit log, so
  // this stays a Phase-7 write stub (persisting a note re-derives the timeline).
  const addNote = () =>
    runFlow({
      title: "Add note",
      steps: ["reason"],
      onComplete: () => pushToast("Note recorded (pending write)", "ok"),
    })

  // Revoke a single session — confirm, then toast (real revocation is Phase 7).
  const revokeSession = () =>
    runFlow({
      title: "Revoke session",
      steps: ["reason"],
      onComplete: () => pushToast("Session revoked (pending write)", "ok"),
    })

  // Remove a single beneficiary — confirm, then toast (real removal is Phase 7).
  const removeBeneficiary = () =>
    runFlow({
      title: "Remove beneficiary",
      steps: ["reason"],
      onComplete: () => pushToast("Beneficiary removed", "ok"),
    })

  const revealLabel = piiRevealed ? "Hide" : "Reveal"
  const revealIcon = piiRevealed
    ? "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9 9 0 0 1 21 12a17 17 0 0 1-2.2 3M6.2 6.2A17 17 0 0 0 3 12s3.5 7 9 7a9 9 0 0 0 3-.5"
    : "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"

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
            {U_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                title={a.label}
                onClick={() => {
                  if (a.label === "Freeze") freezeUser()
                  else if (a.label === "Add note") addNote()
                  else if (a.label === "Resend")
                    pushToast("Verification link re-sent", "info")
                  else if (a.label === "View as")
                    pushToast(`Now viewing as ${name}`, "ok")
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
                {a.label}
              </button>
            ))}
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

      {/* PII BANNER */}
      {piiRevealed && (
        <div className="mb-3.5 flex items-center gap-2.5 rounded-xl border border-[#f2cfc9] bg-sdn px-[15px] py-[11px]">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-tdn"
          >
            <path
              d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          </svg>
          <span className="flex-1 text-[12.5px] font-semibold text-tdn">
            Decrypted PII is visible · this access is logged to the audit trail.
            Auto-remasking in 20s.
          </span>
          <button
            type="button"
            onClick={() => setPiiRevealed(false)}
            className="cursor-pointer text-xs font-bold text-tdn underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Re-mask now
          </button>
        </div>
      )}

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
                  <button
                    type="button"
                    onClick={revealNin}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-[9px] border px-3 py-[7px] text-xs font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                      piiRevealed
                        ? "border-[#f0d0cb] bg-sdn text-tdn"
                        : "border-line bg-card text-ink"
                    )}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d={revealIcon}
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {revealLabel}
                  </button>
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
                Approve · tier_3 (maker-checker)
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
              onClick={forceReKyc}
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
              <button
                type="button"
                onClick={unbindDevice}
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
                  onClick={revokeSession}
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
                    {w.avail}
                  </div>
                  <div
                    className="mt-[3px] text-[11.5px] tabular-nums"
                    style={{
                      color: w.hero ? "rgba(214,226,219,0.65)" : "var(--ink3)",
                    }}
                  >
                    available
                    {w.pending !== null && (
                      <span className="ml-1.5">· {w.pending} pending</span>
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
                    onClick={removeBeneficiary}
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
                        {t.amount}
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

      {/* ===== FLOW MODALS (reason → step-up → engine / maker / pii) ===== */}
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
      <PiiRevealModal
        open={current === "pii"}
        onOpenChange={(o) => !o && cancelFlow()}
        piiLabel={flow?.piiLabel ?? "NIN & BVN"}
        onContinue={() => advance()}
      />
      <EngineActionModal
        open={current === "engine"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        effect={flow?.effect ?? []}
        ledger={flow?.ledger ?? []}
        idempotencyKey="idem_9f31c0a2"
        cta="Execute via engine"
        onExecute={() => advance()}
      />
      <MakerCheckerModal
        open={current === "maker"}
        onOpenChange={(o) => !o && cancelFlow()}
        title={flow?.title ?? ""}
        diff={flow?.diff ?? []}
        onSubmit={() => advance()}
      />
    </div>
  )
}
