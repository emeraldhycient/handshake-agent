/** User detail view — its tabs, flows, and beneficiary oversight. */

import type { AdminBeneficiary } from "@handshake-agent/contracts"
import type {
  EngineEffectRow,
  EngineLedgerRow,
  MakerCheckerDiffRow,
} from "./flows"

/** A design status-pill's tokens: its label + background + foreground CSS vars. */
export interface PillMeta {
  label: string
  bg: string
  fg: string
}

/** The user-detail tab ids (design vUserDetail tab strip). */
export type UdTab =
  | "profile"
  | "kyc"
  | "devices"
  | "security"
  | "wallets"
  | "bene"
  | "tx"
  | "chat"
  | "limits"

/** Header-action keys — dispatch is by key so the freeze label can toggle Freeze↔Unfreeze. */
export type UdActionKey = "freeze" | "note" | "resend"

/** The user-detail error shell (back-link + retry). */
export interface UdErrorProps {
  onBack: () => void
  onRetry: () => void
}

/** The subset of the useEndUserLimits query the Limits tab reads. */
export interface UdLimitsQuery {
  isLoading: boolean
  isError: boolean
  data:
    | import("@handshake-agent/contracts").AdminEndUserLimitsResponse
    | undefined
}

/** The Limits tab: effective caps + live velocity usage for a tier. */
export interface UdLimitsTabProps {
  tier: string
  query: UdLimitsQuery
  /** The operator-selected fiat scope; null → the server default (the response's own fiat). */
  currency: string | null
  /** Catalog fiat codes for the currency chips (empty/1 → no selector rendered). */
  currencyOptions: readonly string[]
  onCurrency: (code: string) => void
  onRetry: () => void
}

/** The Limits tab's fiat-scope chip row (one chip per catalog fiat). */
export interface UdLimitsCurrencyChipsProps {
  options: readonly string[]
  /** The chip to highlight (the selected/served currency); null → none. */
  active: string | null
  onSelect: (code: string) => void
}

/** One labelled velocity bar (used / cap + a clamped progress track). */
export interface UdVelocityBarProps {
  label: string
  used: string
  cap: string
  pct: string
}

/** The Beneficiaries tab — the user's saved beneficiaries + a per-row remove flow. */
export interface UdBeneficiariesTabProps {
  beneficiaries: import("@handshake-agent/contracts").AdminEndUserDetail["beneficiaries"]
  onRemove: (id: string) => void
}

/** The Transactions tab — the user's recent transactions (rows navigate to tx detail). */
export interface UdTransactionsTabProps {
  transactions: import("@handshake-agent/contracts").AdminEndUserDetail["recentTransactions"]
  onOpenTx: (id: string) => void
}

/**
 * A minimal structural view of a TanStack read query (the four async branches) —
 * so a detail-tab prop can carry the query state without `types/` importing the
 * hook's `UseQueryResult` (layering-safe, like `UdLimitsQuery`). Modelled as a
 * discriminated union on `isSuccess` so `isSuccess && data.x` narrows `data` to a
 * defined value exactly as the real query result does (keeps the tab JSX verbatim).
 */
export type UdQueryState<T> =
  | {
      isLoading: boolean
      isError: boolean
      isSuccess: false
      data: T | undefined
    }
  | { isLoading: boolean; isError: boolean; isSuccess: true; data: T }

/** The Profile tab — contact & locale + the admin-action timeline and case notes. */
export interface UdProfileTabProps {
  detail: import("@handshake-agent/contracts").AdminEndUserDetail
  timeline: UdQueryState<
    import("@handshake-agent/contracts").AdminEndUserTimelineEntry[]
  >
  notes: UdQueryState<
    import("@handshake-agent/contracts").AdminUserNoteListResponse
  >
  onAddNote: () => void
  onRetryTimeline: () => void
  onRetryNotes: () => void
}

/** The KYC tab — last-4 identity docs + liveness + the review-decision / tier controls. */
export interface UdKycTabProps {
  /** The KYC submission (last-4 PII only); undefined until the query settles (§3.4). */
  kyc: import("@handshake-agent/contracts").KycSubmissionDetail | undefined
  /** The tier an Approve promotes to (derived from the submission's requested tier). */
  approveTier: string
  onApprove: () => void
  onRequestInfo: () => void
  onReject: () => void
  onOverrideTier: () => void
  onForceReKyc: () => void
}

/** The KYC tab's left column — identity documents (last-4 only, §3.4) + liveness. */
export interface UdKycIdentityPanelProps {
  kyc: import("@handshake-agent/contracts").KycSubmissionDetail | undefined
}

/** The KYC tab's right column — the review-decision buttons + tier controls. */
export interface UdKycReviewPanelProps {
  approveTier: string
  onApprove: () => void
  onRequestInfo: () => void
  onReject: () => void
  onOverrideTier: () => void
  onForceReKyc: () => void
}

/** The Devices tab — bound/revoked devices with per-row unbind + SIM-swap re-verify. */
export interface UdDevicesTabProps {
  devices: UdQueryState<
    import("@handshake-agent/contracts").AdminEndUserDevice[]
  >
  simSwapFlagged: boolean
  onReverify: () => void
  onUnbind: (deviceId: string) => void
  onRetry: () => void
}

/** The Security tab — PIN/auth reset + active sessions (per-row + revoke-all). */
export interface UdSecurityTabProps {
  sessions: UdQueryState<
    import("@handshake-agent/contracts").AdminEndUserSession[]
  >
  onResetPin: () => void
  onRevokeAll: () => void
  onRevokeSession: (sessionId: string) => void
  onRetry: () => void
}

/** The Wallets tab — balance cards + on-chain deposit addresses + manual-credit entry. */
export interface UdWalletsTabProps {
  balances: import("@handshake-agent/contracts").AdminEndUserDetail["balances"]
  depositAddresses: import("@handshake-agent/contracts").AdminEndUserDetail["depositAddresses"]
  onManualCredit: () => void
}

/** The steps a user-detail action flow walks (design runFlow: credit → reason → step-up → engine/maker). */
export type UdFlowStep = "credit" | "reason" | "engine" | "maker"

/** A user-detail action flow's config: title, step sequence, modal payloads, and the completion side-effect. */
export interface UdFlowConfig {
  title: string
  steps: UdFlowStep[]
  effect?: EngineEffectRow[]
  ledger?: EngineLedgerRow[]
  diff?: MakerCheckerDiffRow[]
  /**
   * When true, the flow's `maker` step renders the MakerCheckerModal in
   * `dual-control` mode (it raises a real four-eyes ChangeRequest a second admin
   * approves) rather than the honest immediate copy. Used by the tier-override flow.
   */
  dualControl?: boolean
  /** Side-effect run once the final step is confirmed (mutations, toasts); gets the captured reason. */
  onComplete?: (reason: string) => void
}

/** The manual-credit input the ManualCreditModal captures (asset + entered amount). */
export type CreditInput = {
  asset: import("@handshake-agent/contracts").SupportedAsset
  amount: string
}

/**
 * The minimal step-up controller the user-detail flow modals consume — the
 * server-driven 403 → StepUpDialog `open`/`setOpen` pair. Structural on purpose so
 * `types/` never imports the `useStepUpRetry` hook; its `StepUpRetry` return is
 * assignable to this (same layering-safe pattern as `UdQueryState`).
 */
export interface UdStepUpController {
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * UserDetail header — the back-link + identity card (avatar monogram, name, FROZEN /
 * KYC / SIM-swap pills, copyable id) and the freeze / add-note / resend actions. The
 * name, initials, frozen and KYC-pill meta are derived from `detail`/`kyc` inside.
 */
export interface UserDetailHeaderProps {
  detail: import("@handshake-agent/contracts").AdminEndUserDetail
  kyc: import("@handshake-agent/contracts").KycSubmissionDetail | undefined
  simSwapFlagged: boolean
  onBack: () => void
  onFreeze: () => void
  onAddNote: () => void
  onResend: () => void
}

/** UserDetail tab strip (underline nav) — the active tab id + its setter. */
export interface UserDetailTabsProps {
  tab: UdTab
  onTab: (tab: UdTab) => void
}

/**
 * UserDetail flow modals — the credit → reason → engine / maker step sequence plus
 * the shared server-driven step-up dialog. Renders whichever modal the flow's
 * `current` step selects; the credit-preview tables derive from the captured
 * `creditInput` (§3.1 — nothing here moves money; the engine settles only after a
 * SECOND admin approves the four-eyes request).
 */
export interface UserDetailFlowModalsProps {
  userId: string
  balances: import("@handshake-agent/contracts").AdminEndUserDetail["balances"]
  current: UdFlowStep | null
  flow: UdFlowConfig | null
  creditInput: CreditInput | null
  setCreditInput: (input: CreditInput) => void
  creditInputRef: import("react").RefObject<CreditInput | null>
  advance: (reason?: string) => void
  cancelFlow: () => void
  stepUp: UdStepUpController
  mfaEnabled: boolean
  onStepUpSuccess: () => void
}

// ─── Beneficiary oversight (in user detail) ────────────────────────────────────────

export interface BeneficiaryOverrideProps {
  /** The beneficiary whose first-use cooling-off lock can be cleared. */
  beneficiary: AdminBeneficiary
}

/** One beneficiary row — icon tile · label + type · verification pill · cooling-off · override. */
export interface BeneficiaryRowProps {
  beneficiary: AdminBeneficiary
}

/** The beneficiaries list card — the four async branches over the list read. */
export interface BeneficiariesListProps {
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  items: readonly AdminBeneficiary[]
}
