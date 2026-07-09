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
import { formatCrypto } from "@/lib/format"
import { pushToast } from "@/lib/store/toast-store"
import {
  EngineActionModal,
  MakerCheckerModal,
  ManualCreditModal,
  ReasonModal,
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
import { displayName, initialsOf } from "@/lib/users/user-detail"
import { KYC_STATUS_META, TABS, U_ACTIONS } from "@/constants/user-detail"
import { useUserDetailScreen } from "@/lib/hooks/use-user-detail"
import {
  UserDetailError,
  UserDetailSkeleton,
} from "@/components/admin/user-detail/shells"
import { LimitsTab } from "@/components/admin/user-detail/limits-tab"
import { ChatTab } from "@/components/admin/user-detail/chat-tab"
import { BeneficiariesTab } from "@/components/admin/user-detail/beneficiaries-tab"
import { TransactionsTab } from "@/components/admin/user-detail/transactions-tab"
import { ProfileTab } from "@/components/admin/user-detail/profile-tab"
import { KycTab } from "@/components/admin/user-detail/kyc-tab"
import { DevicesTab } from "@/components/admin/user-detail/devices-tab"
import { SecurityTab } from "@/components/admin/user-detail/security-tab"
import { WalletsTab } from "@/components/admin/user-detail/wallets-tab"

export function UserDetail({ userId }: UserDetailProps) {
  const {
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
        <ProfileTab
          detail={detail}
          timeline={timelineQuery}
          notes={notesQuery}
          onAddNote={addNote}
          onRetryTimeline={() => void timelineQuery.refetch()}
          onRetryNotes={() => void notesQuery.refetch()}
        />
      )}

      {/* ===== KYC ===== */}
      {tab === "kyc" && (
        <KycTab
          kyc={kyc}
          approveTier={approveTier}
          onApprove={kycApprove}
          onRequestInfo={kycInfo}
          onReject={kycReject}
          onOverrideTier={overrideTier}
          onForceReKyc={forceReKycFlow}
        />
      )}

      {/* ===== DEVICES ===== */}
      {tab === "devices" && (
        <DevicesTab
          devices={devicesQuery}
          simSwapFlagged={simSwapFlagged}
          onReverify={simSwapReverifyUser}
          onUnbind={unbindDevice}
          onRetry={() => void devicesQuery.refetch()}
        />
      )}

      {/* ===== SECURITY ===== */}
      {tab === "security" && (
        <SecurityTab
          sessions={sessionsQuery}
          onResetPin={resetPin}
          onRevokeAll={revokeAll}
          onRevokeSession={revokeSession}
          onRetry={() => void sessionsQuery.refetch()}
        />
      )}

      {/* ===== WALLETS ===== */}
      {tab === "wallets" && (
        <WalletsTab
          balances={detail.balances}
          depositAddresses={detail.depositAddresses}
          onManualCredit={manualCredit}
        />
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
          currency={limitsCurrency}
          currencyOptions={limitsCurrencyOptions}
          onCurrency={setLimitsCurrency}
          onRetry={() => void limitsQuery.refetch()}
        />
      )}

      {/* ===== FLOW MODALS (credit → reason → engine / maker; the REAL step-up
             is server-driven — 403 → StepUpDialog → replay) ===== */}
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
        // The manual credit AND the per-user tier override raise a REAL four-eyes
        // ChangeRequest (dual-control); the KYC approve applies immediately after
        // server step-up, so its confirm carries the honest immediate copy.
        mode={isCreditFlow || flow?.dualControl ? "dual-control" : "immediate"}
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
