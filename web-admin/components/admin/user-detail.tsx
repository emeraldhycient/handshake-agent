"use client"

/**
 * UserDetail — the Operator Console user-detail screen (design
 * `docs/design-ref/screens/UserDetail.html`), wired to REAL admin data.
 *
 * Composition only. The read queries + the flow-modal state machine + every write
 * action (Freeze / Approve-Reject / tier / device + session + beneficiary revoke /
 * PIN reset / SIM-swap / force-re-KYC / add-note / manual-credit) live in
 * `useUserDetailScreen`. The orchestrator wraps the aggregate in its four async
 * branches (loading / error+retry / data) and arranges the sections: `UserDetailHeader`
 * (identity + header actions), `UserDetailTabs`, the per-tab bodies, and
 * `UserDetailFlowModals` (the credit → reason → engine / maker steps + step-up).
 *
 * The model only proposes (§3.1): each sensitive mutation is step-up-gated (403 →
 * StepUpDialog → replay) and a tier-override / manual-credit is a four-eyes
 * maker-checker request a SECOND admin approves — nothing here writes a ledger entry
 * or moves money. Identity PII is last-4 only (§3.4). Table rows navigate to the
 * transaction-detail route.
 */
import type { UserDetailProps } from "@/types"
import { useUserDetailScreen } from "@/lib/hooks/use-user-detail"
import {
  UserDetailError,
  UserDetailSkeleton,
} from "@/components/admin/user-detail/shells"
import { UserDetailHeader } from "@/components/admin/user-detail/header"
import { UserDetailTabs } from "@/components/admin/user-detail/tabs"
import { UserDetailFlowModals } from "@/components/admin/user-detail/flow-modals"
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
  const simSwapFlagged = detail.simSwapDetectedAt !== null

  return (
    <div
      data-screen-label="User detail"
      className="mx-auto w-full max-w-[1200px] overflow-y-auto px-[30px] pt-[22px] pb-[60px]"
    >
      <UserDetailHeader
        detail={detail}
        kyc={kyc}
        simSwapFlagged={simSwapFlagged}
        onBack={() => router.push("/users")}
        onFreeze={freezeUser}
        onAddNote={addNote}
        onResend={resendUser}
      />

      <UserDetailTabs tab={tab} onTab={setTab} />

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

      <UserDetailFlowModals
        userId={userId}
        balances={detail.balances}
        current={current}
        flow={flow}
        creditInput={creditInput}
        setCreditInput={setCreditInput}
        creditInputRef={creditInputRef}
        advance={advance}
        cancelFlow={cancelFlow}
        stepUp={stepUp}
        mfaEnabled={mfaEnabled}
        onStepUpSuccess={onStepUpSuccess}
      />
    </div>
  )
}
