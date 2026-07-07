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
 * aggregate. Composition only: the tab state, the per-tab read queries, and the
 * flow-modal state machine + every write action (Freeze / Approve-Reject / tier /
 * device + session + beneficiary revoke / PIN reset / SIM-swap / force-re-KYC /
 * add-note / manual-credit) live in `useUserDetailScreen`. The model only proposes
 * (§3.1): each sensitive mutation is step-up-gated (403 → StepUpDialog → replay) and
 * a tier-override / manual-credit is a four-eyes maker-checker request a SECOND admin
 * approves — nothing here writes a ledger entry or moves money. Table rows navigate
 * to the transaction-detail route.
 */
import { cn } from "@/lib/utils"
import { formatCrypto, formatCryptoAmount } from "@/lib/format"
import { pushToast } from "@/lib/store/toast-store"
import { Skeleton } from "@/components/ui/skeleton"
import {
  EngineActionModal,
  MakerCheckerModal,
  ManualCreditModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { StepUpDialog } from "@/components/admin/step-up-dialog"
import { SupportedAssetSchema } from "@handshake-agent/contracts"
import type { SupportedAsset } from "@handshake-agent/contracts"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
  UserDetailProps,
} from "@/types/components"
import {
  actionDot,
  actionLabel,
  displayName,
  initialsOf,
} from "@/lib/users/user-detail"
import {
  KYC_STATUS_META,
  NOT_PROVIDED,
  TABS,
  U_ACTIONS,
} from "@/constants/user-detail"
import { useUserDetailScreen } from "@/lib/hooks/use-user-detail"
import { Panel } from "@/components/admin/user-detail/panel"
import {
  UserDetailError,
  UserDetailSkeleton,
} from "@/components/admin/user-detail/shells"
import { LimitsTab } from "@/components/admin/user-detail/limits-tab"
import { ChatTab } from "@/components/admin/user-detail/chat-tab"
import { BeneficiariesTab } from "@/components/admin/user-detail/beneficiaries-tab"
import { TransactionsTab } from "@/components/admin/user-detail/transactions-tab"

export function UserDetail({ userId }: UserDetailProps) {
  const {
    router,
    detailQuery,
    kycQuery,
    devicesQuery,
    sessionsQuery,
    limitsQuery,
    timelineQuery,
    notesQuery,
    mfaEnabled,
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
    approveTier,
  } = useUserDetailScreen(userId)

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
        <BeneficiariesTab
          beneficiaries={detail.beneficiaries}
          onRemove={removeBeneficiaryFlow}
        />
      )}

      {/* ===== TRANSACTIONS ===== */}
      {tab === "tx" && (
        <TransactionsTab
          transactions={detail.recentTransactions}
          onOpenTx={openTx}
        />
      )}

      {/* ===== CHAT ===== */}
      {tab === "chat" && <ChatTab />}

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
        mfaEnabled={mfaEnabled}
        onOpenChange={stepUp.setOpen}
        onSuccess={onStepUpSuccess}
      />
    </div>
  )
}
