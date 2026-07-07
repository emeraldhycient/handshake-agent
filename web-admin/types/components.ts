/**
 * Centralized component prop types (`XxxProps`) for the admin app.
 * No inline component prop types — components import their props from here
 * (root §13.4). Shapes that cross the FE/BE boundary come from contracts.
 */
import type { ComponentPropsWithoutRef, ReactNode } from "react"

/** Shared admin page header — title + optional subtitle + right-aligned actions. */
export interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}

/**
 * The four master-ledger view tabs (design §6.8 `txViews`). `all` is unfiltered;
 * `stuck` narrows to in-flight transactions, `failed` to failures, `refunds` to
 * the refund type. The active tab drives the keyed `useTransactions` query.
 */
export type TransactionsView = "all" | "stuck" | "failed" | "refunds"

export interface TxnRowProps {
  txn: import("@handshake-agent/contracts").AdminTxnListItem
  onOpen: () => void
}

export interface TransactionViewTabsProps {
  view: TransactionsView
  counts?: import("@handshake-agent/contracts").AdminTxnViewCounts
  search: string
  onSelectView: (view: TransactionsView) => void
  onSearch: (value: string) => void
}

/** Keyset cursor pager (Prev / Next + page number). */
export interface CursorPaginatorProps {
  pageIndex: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  /** Left-aligned status text; defaults to `Page {pageIndex}`. */
  leftLabel?: ReactNode
  /** When true, both buttons are disabled (e.g. a page fetch is in flight). */
  busy?: boolean
}

/** The 7-column ledger table with its own loading / error / empty / data branches. */
export interface TxnLedgerProps {
  rows: import("@handshake-agent/contracts").AdminTxnListItem[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  /** Drives the "no match" empty copy (search vs. plain view). */
  search: string
  onRetry: () => void
  onOpen: (id: string) => void
}

/** One per-currency money figure (mirrors the metrics `byCurrency` entries). */
export interface CurrencyAmount {
  currency: string
  amount: string
}

/** One point on a trend chart (an x label + a numeric y value). */
export interface TrendPoint {
  label: string
  value: number
}

/**
 * TrendChart props — a self-contained SVG line/area chart (no chart lib). Renders
 * `points` as a normalized line (optional area fill) using `currentColor`, so the
 * caller sets the hue via a `text-*` class. Empty points → an inline "No data".
 */
export interface TrendChartProps {
  points: readonly TrendPoint[]
  /** Accessible description of the series (required — the chart is an image). */
  ariaLabel: string
  /** Fill the area under the line (default true). */
  area?: boolean
  className?: string
}

/** A header + rows payload ready to serialize to CSV. */
export interface CsvExportData {
  headers: readonly string[]
  rows: (string | number)[][]
}

/**
 * ExportCsvButton props (go-readiness #7 per-area export). `build` runs at click
 * time so the CSV is serialized only on demand. `onDownload` is injectable for
 * tests; it defaults to the real browser download in `lib/csv`.
 */
export interface ExportCsvButtonProps {
  filename: string
  build: () => CsvExportData
  label?: string
  disabled?: boolean
  onDownload?: (filename: string, csv: string) => void
}

/**
 * Metrics filter-bar state: the selected range preset (or "custom"), the custom
 * from/to date-only strings ('' when a preset is active), and the optional
 * capability / tier / currency filters ('' = all). Resolved into a MetricsRangeQuery
 * by `metricsQueryFromFilter`.
 */
export interface MetricsFilterState {
  presetId: string
  from: string
  to: string
  capability: string
  tier: string
  currency: string
}

/** MetricsFilterBar props — controlled: parent owns the state + resolves the query. */
export interface MetricsFilterBarProps {
  value: MetricsFilterState
  onChange: (next: MetricsFilterState) => void
}

/**
 * PlatformKpisCard props — presentational (parent owns the `usePlatformKpis`
 * query and passes the async branches as props).
 */
export interface PlatformKpisCardProps {
  data: import("@handshake-agent/contracts").PlatformKpis | undefined
  isLoading: boolean
  isError: boolean
}

/** Which money metric a trend chart is plotting. */
export type MoneyMetric = "gmv" | "revenue" | "profit"

/**
 * MoneyTrendCard props — presentational (no fetching): the parent owns the
 * `useMoneySeries` query and passes its result down as the four async branches.
 */
export interface MoneyTrendCardProps {
  data: import("@handshake-agent/contracts").MoneySeriesMetrics | undefined
  isLoading: boolean
  isError: boolean
}

/**
 * One day of a money time-series, resolved for a single currency: the exact
 * decimal `amount` (for display via `formatFiat`) and its `value` (a JS number
 * for chart geometry only — precision loss is acceptable for pixel positions).
 */
export interface MoneySeriesPoint {
  date: string
  amount: string
  value: number
}
import type {
  AdminBeneficiary,
  AdminCustomFiatCreateRequest,
  AdminEndUserDetail,
  AdminEndUserDevice,
  AdminEndUserListItem,
  AdminPermissionRecord,
  AdminUser,
  AmlRule,
  ComplianceReport,
  EffectiveSetting,
  KycTier,
  KycSubmissionDetail,
  NotificationTemplate,
  Role,
  TreasuryAlert,
} from "@handshake-agent/contracts"

// ─── Shell + gating ──────────────────────────────────────────────────────────────

export interface AppShellProps {
  children: ReactNode
}

/** The permission gate wrapped around the shell's main content (RouteGuard). */
export interface RouteGuardProps {
  children: ReactNode
}

// ─── Topbar controls (command palette / notifications / account) ────────────────

/**
 * A flattened, navigable destination sourced from the shell's nav groups —
 * the command palette's search corpus (every reachable screen).
 */
export interface NavDestination {
  href: string
  label: string
  group: string
}

export interface CommandPaletteProps {
  /** Controlled open state — driven by the search pill + the ⌘K shortcut. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The navigable destinations to search (the shell's flattened nav). */
  destinations: readonly NavDestination[]
}

/** The four alert-pip badges the sidebar can show on a nav item. */
export type NavBadgeKey = "kyc" | "stuck" | "recon" | "approvals"

/**
 * Live counts for the sidebar nav-item alert pips, keyed by badge. Sourced from
 * the real read endpoints (KYC review-queue depth / stuck-transaction count /
 * open reconciliation breaks / maker-checker requests awaiting the caller) — the
 * design's hardcoded counts are gone. A `0` renders no pip.
 */
export type NavBadgeCounts = Record<NavBadgeKey, number>

export interface AccountMenuProps {
  /** The signed-in operator's email (from `useAdminMe`). */
  email: string
  /**
   * The operator's real role label (from `useAdminMe`), shown as an honest
   * read-only display on the account pill. There is no view-as impersonation
   * switcher — the console never re-scopes to another role client-side.
   */
  realRoleLabel: string
  /** Sign the operator out (the shell's auth-store `clear`). */
  onSignOut: () => void
}

export interface LoginFormProps {
  className?: string
}

// ─── Step-up flow ────────────────────────────────────────────────────────────────

export interface StepUpDialogProps {
  open: boolean
  /** Whether the signed-in admin has MFA enabled (drives password vs TOTP). */
  mfaEnabled: boolean
  /** Called after a successful step-up — the caller retries its mutation. */
  onSuccess: () => void
  onOpenChange: (open: boolean) => void
}

export interface MfaEnrollDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Admins page ─────────────────────────────────────────────────────────────────

export interface InviteAdminDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roles: Role[]
}

export interface AdminRowActionsProps {
  admin: AdminUser
  roles: Role[]
}

/**
 * One cell of the role permission matrix (design §6.15): the access level a role
 * has for a permission category, derived from the role's granted permission ids.
 * `full` = grants a write/execute/delete action in the category; `read` = grants
 * only reads; `none` = grants nothing. The level (not colour alone) is the
 * signal — each level carries a distinct icon + title.
 */
export type PermissionMatrixLevel = "full" | "read" | "none"

/** A resolved matrix row: one permission category across every role column. */
export interface PermissionMatrixRow {
  /** The category label (e.g. "KYC", "Transactions"). */
  label: string
  /** Access level per role, index-aligned to the matrix's role columns. */
  cells: PermissionMatrixLevel[]
}

export interface RolePermissionMatrixProps {
  /** The role columns (built-in + custom). */
  roles: Role[]
  /** The permission catalog used to resolve each cell's access level. */
  permissions: AdminPermissionRecord[]
}

// ─── Roles page ──────────────────────────────────────────────────────────────────

export interface RoleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing role, or null to create a new one. */
  role: Role | null
}

// ─── Users page ──────────────────────────────────────────────────────────────────

/** A resolved KYC-status → design token-pair descriptor for the users table. */
export interface UserKycMeta {
  /** The bucket label rendered in the pill (Verified / Pending / …). */
  label: string
  /** Tailwind background-token utility (`bg-sok`/`bg-swn`/…). */
  bg: string
  /** Tailwind text-token utility (`text-tok`/`text-twn`/…). */
  fg: string
}

/** The three risk facets the users filter row exposes as toggle chips. */
export type UserRiskFlag = "simSwap" | "sanctions" | "velocity"

/** A rendered risk-filter chip's derived state. */
export interface UserRiskChip {
  value: UserRiskFlag
  label: string
  active: boolean
}

/** A user's KYC bucket → the design's `kycMeta` pill mapping (logic.js line 496). */
export type UserKycStatus = "verified" | "pending" | "needs_info" | "rejected"

/**
 * A presentation row derived from an `AdminEndUserListItem` (via `toRow`). The
 * live shape the Users table renders — avatar hue + initials are derived (no
 * colour field in the list contract); `balance` / `lastActive` are pre-formatted.
 */
export interface UsersRow {
  id: string
  name: string
  email: string
  /** 2-letter avatar initials (`lib/avatar` `initialsOf`). */
  initials: string
  /** Avatar background hex, derived deterministically from the id. */
  avatar: string
  kyc: UserKycStatus
  tier: KycTier
  simSwapFlagged: boolean
  sanctionsFlagged: boolean
  /** Pre-formatted per-asset balance summary (or em dash). */
  balance: string
  /** Relative "last active" label (or em dash when never active). */
  lastActive: string
}

/** One Users-directory row — selectable checkbox + opens the detail route. */
export interface UserRowProps {
  user: UsersRow
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: (id: string) => void
}

/** Users-directory header — count/total + the CSV export affordance. */
export interface UsersHeaderProps {
  shown: number
  total?: number
  /** Shown when there is no server `total` but a next page exists. */
  moreAvailable: boolean
  exporting: boolean
  onExport: () => void
}

/** The Users-directory filter row: search + KYC/tier/country selects + risk chips. */
export interface UsersFilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  kyc: string
  onKycChange: (value: string) => void
  tier: string
  onTierChange: (value: string) => void
  country: string
  onCountryChange: (value: string) => void
  risk: UserRiskFlag | ""
  onToggleRisk: (value: UserRiskFlag) => void
}

/** The contextual bulk-actions bar shown when rows are selected. */
export interface UsersBulkBarProps {
  count: number
  exporting: boolean
  onExport: () => void
  selectedIds: readonly string[]
  /** Clears the selection after a successful tag/message op. */
  onActionDone: () => void
  onClear: () => void
}

/** The 7-column directory table with its own loading / error / empty / data branches. */
export interface UsersTableProps {
  rows: UsersRow[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  allSelected: boolean
  selectedIds: readonly string[]
  onToggleSelectAll: () => void
  onToggleSelect: (id: string) => void
  onRetry: () => void
  onOpen: (id: string) => void
}

export interface UserStatusBadgeProps {
  /** An end-user account status (distinct from the admin-console statuses). */
  status: AdminEndUserListItem["status"]
}

export interface KycStatusBadgeProps {
  status: AdminEndUserListItem["kycStatus"]
}

export interface UserDetailProps {
  /** The route's user id (`/users/[id]`). */
  userId: string
}

export interface UserDeviceListProps {
  userId: string
  devices: AdminEndUserDevice[]
}

export interface UserActionsProps {
  /** The loaded aggregate — drives which transitions are offered. */
  user: AdminEndUserDetail
}

/**
 * The Users-directory bulk-bar actions (tag + message) over the current selection.
 * `selectedIds` is the explicit set the two operations target; `onDone` is called
 * after a successful op so the page can clear the selection.
 */
export interface UsersBulkActionsProps {
  selectedIds: readonly string[]
  onDone: () => void
}

// ─── KYC review page ─────────────────────────────────────────────────────────────

/**
 * One row in the KYC review queue (design `kycRows`, logic.js `vKyc()` line 645).
 * Design-reproduction screen: these are the design's own mock values, not live
 * queue data. `slaTone` maps the design's `slaFg` (near-black ink vs. `--tdn`
 * for the stalest bucket) onto a token utility class.
 */
export interface KycQueueRow {
  /** Applicant display name (design seed, e.g. "Amara Okeke"). */
  name: string
  /** Applicant user id — the row's navigation target (`/users/[id]`). */
  id: string
  /** Two-letter monogram for the avatar (design `ini()`). */
  initials: string
  /** Avatar background — a raw hue from the design's `AVA` palette. */
  avatar: string
  /** Requested KYC tier (`tier_1` | `tier_2` | `tier_3`). */
  tier: string
  /** SLA age label (design: "2h" / "6h" / "1d 4h"). */
  sla: string
  /** SLA-age urgency tone: normal ink, or danger for the stalest bucket. */
  slaTone: "ink" | "danger"
  /** Assignee name, or "Unassigned" (design alternates the two). */
  assignee: string
}

export interface KycQueueRowProps {
  /** The design-mock row this line renders. */
  row: KycQueueRow
  /** Navigate to the applicant's user-detail KYC tab (design `openUserKyc`). */
  onOpen: (userId: string) => void
}

export interface KycSubmissionProps {
  /** The selected submission's userId, or null when the drawer is closed. */
  userId: string | null
  onOpenChange: (open: boolean) => void
}

export interface KycReviewActionsProps {
  submission: KycSubmissionDetail
}

// ─── Transactions page + detail ────────────────────────────────────────────────

export interface TransactionDetailProps {
  /** The transaction id resolved from the `[id]` route segment. */
  transactionId: string
}

// ─── Compliance page ─────────────────────────────────────────────────────────────

export interface ComplianceEventDetailProps {
  /** The selected event's id, or null when the drawer is closed. */
  eventId: string | null
  onOpenChange: (open: boolean) => void
}

export interface AmlRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing rule, or null to create a new one. */
  rule: AmlRule | null
}

// ─── AML / risk page (§6.6) ─────────────────────────────────────────────────────────

export interface AmlRiskRuleRowProps {
  /** The engine rule rendered as a design risk-rule row. */
  rule: AmlRule
  /** Opens the maker-checker edit dialog for this rule. */
  onEdit: (rule: AmlRule) => void
}

export interface ComplianceReportDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ComplianceReportSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The drafted report being submitted, or null when the dialog is closed. */
  report: ComplianceReport | null
}

// ─── Beneficiary oversight (in user detail) ────────────────────────────────────────

export interface BeneficiaryOverrideProps {
  /** The beneficiary whose first-use cooling-off lock can be cleared. */
  beneficiary: AdminBeneficiary
}

// ─── Treasury writes (§6.13) ────────────────────────────────────────────────────────

export interface TreasuryAlertAcknowledgeProps {
  /** The threshold-breach alert to acknowledge (captures an audited note). */
  alert: TreasuryAlert
}

// ─── Blocked list page (§6.7) ──────────────────────────────────────────────────────

/** One deny-list row — active entries offer Unblock; superseded ones are audit history. */
export interface BlockedRowProps {
  entry: import("@handshake-agent/contracts").BlockedEntry
  onUnblock: () => void
}

/** The deny-list table card — loading / error / empty / data over `BlockedRow`. */
export interface BlockedTableProps {
  entries: import("@handshake-agent/contracts").BlockedEntry[]
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onRetry: () => void
  onUnblock: (entry: import("@handshake-agent/contracts").BlockedEntry) => void
}

/** The active supersede (unblock) flow: reason (audited) → step-up (client TOTP) → POST. */
export interface SupersedeFlow {
  id: string
  value: string
  reason: string
  step: "reason" | "stepup"
}

/** A pending add awaiting its audited reason (the dialog already collected the value). */
export interface PendingAdd {
  value: string
}

/** An action awaiting a server step-up replay (so the post-re-auth toast reads right). */
export type PendingReplay =
  | { kind: "add"; value: string }
  | { kind: "supersede"; value: string }

export interface AddBlockedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current denylist; the new value is appended and the whole array saved. */
  denylist: string[]
  /**
   * Persist the next denylist. Returns the mutation promise so the dialog can
   * await, surface its own error, and close on success. May trigger a step-up
   * challenge that the parent resolves.
   */
  onSave: (next: string[]) => Promise<void>
}

export interface AddCurrencyDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing fiat codes (built-in + custom), upper-cased — for a fast local
   * duplicate check before the server's 409. */
  existingCodes: string[]
  /**
   * Persist the new custom currency. Returns the mutation promise so the dialog
   * can await, surface its own error inline, and close on success. May trigger a
   * step-up challenge that the parent resolves.
   */
  onSave: (input: AdminCustomFiatCreateRequest) => Promise<void>
}

// ─── Notifications page (Phase 4) ──────────────────────────────────────────────────

export interface TemplateEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Editing an existing template, or null to create a new one. */
  template: NotificationTemplate | null
}

// ─── Agent page (Phase 4) ──────────────────────────────────────────────────────────

export interface ConversationLogDetailProps {
  /** The selected conversation's id, or null when the drawer is closed. */
  conversationId: string | null
  onOpenChange: (open: boolean) => void
}

// ─── Metrics dashboard (Phase 5, FINAL) ──────────────────────────────────────────────

export interface MetricsBarProps {
  /** Accessible label describing what this bar represents. */
  label: string
  /** The bar's value; clamped to [0, max] for the rendered width. */
  value: number
  /** The scale maximum (the 100%-width reference). Non-positive → an empty track. */
  max: number
  /** Optional right-aligned caption (e.g. the formatted value or a percentage). */
  caption?: string
}

export interface MetricsDashboardProps {
  /**
   * When true the metrics query 403 (no Metrics grant) degrades to a friendly
   * empty state instead of an error — used on the ungated home page (§3.3 UX).
   */
  gracefulOnForbidden?: boolean
}

// ─── Operator dashboard (design revamp — Dash screen) ─────────────────────────────────

export interface OperatorDashboardProps {
  /**
   * When true the metrics query 403 (no Metrics grant) degrades to a friendly
   * empty state for the KPI/volume/health/KYC blocks instead of an error — used
   * on the ungated home page (§3.3 UX). The design-faithful attention sections
   * (activity / approvals / alerts) render regardless.
   */
  gracefulOnForbidden?: boolean
}

// ─── Feature flags page (design §6.28) ─────────────────────────────────────────────
// PIXEL-FOR-PIXEL design reproduction. The rows render the design's OWN mock flag
// seed (`docs/design-ref/screens/Flags.html`): a mono key, a description, a
// per-cohort / percentage `rollout` chip, the `eval → on/off` effective-evaluation
// preview, and a 52px soft toggle. Real-data reintegration (the effective-config
// registry) is a separate later step — there is no data-fetch on this screen.

/**
 * One design-mock feature-flag row (design §6.28). `on` drives the toggle track +
 * `eval → on/off` preview; `rollout` is the per-cohort / percentage chip label.
 */
export interface FeatureFlagRow {
  /** Stable key (also the mono flag key rendered in the row). */
  key: string
  /** One-line description of what the flag gates. */
  desc: string
  /** The per-cohort / percentage rollout chip label (e.g. "100% · all users"). */
  rollout: string
  /** Whether the flag is currently enabled (drives the toggle + eval preview). */
  on: boolean
}

// ─── Admin settings page (design §6.16) ────────────────────────────────────────────
// The signed-in operator's OWN profile + preferences. Profile + 2FA come from
// `useAdminMe`; the Theme row is wired to the theme store. Notification
// preference toggles have no endpoint yet, so they are design-faithful local
// state — this descriptor shapes the component's own sample rows, not a DTO.

/** A notification-preference toggle key (design-faithful — no API yet). */
export type AdminPreferenceKey =
  | "emailAlerts"
  | "approvalMentions"
  | "weeklyDigest"

/** One rendered preference-toggle row (label + description + current value). */
export interface AdminPreferenceRow {
  key: AdminPreferenceKey
  /** The row title (e.g. "Email alerts"). */
  label: string
  /** The one-line explanation under the title. */
  desc: string
}

// ─── Reconciliation page (design §6.12) ────────────────────────────────────────────
// No reconciliation endpoint exists yet, so the Recon screen is design-faithful:
// these shapes describe the component's local sample content, not a contracts DTO.

/** Break severity → the canonical status pill (high=danger, medium=warn, low=info). */
export type ReconBreakSeverity = "high" | "medium" | "low"

/** What the operator did to close a break (drives the confirmed-outcome footer). */
export type ReconBreakResolution = "resolved" | "accepted" | "escalated"

/** A live `ReconBreak` (contract) with a locally-applied disposition overlaid. */
export type ReconBreakView = import("@handshake-agent/contracts").ReconBreak & {
  localResolution?: ReconBreakResolution
}

/** The three action flows a break card can open (each with its stage). */
export type ReconFlowStep =
  | { kind: "resolve"; stage: "reason" | "engine" }
  | { kind: "accept"; stage: "reason" | "confirm" }
  | { kind: "escalate" }

/** The cron status bar over the break board — last/next run + open-breaks + Run now. */
export interface ReconStatusBarProps {
  status: import("@handshake-agent/contracts").ReconStatus | undefined
  isLoading: boolean
  isError: boolean
  openCount: number
  onRunNow: () => void
}

/** One reconciliation break card — open shows the action row, closed the outcome footer. */
export interface ReconBreakCardProps {
  item: ReconBreakView
  onOpenTx: (transactionId: string) => void
  onEscalate: (id: string) => void
  onAccept: (id: string) => void
  onResolve: (id: string) => void
}

/** The break board — loading / error / empty / data over `ReconBreakCard`. */
export interface ReconBreakListProps {
  breaks: ReconBreakView[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  onOpenTx: (transactionId: string) => void
  onEscalate: (id: string) => void
  onAccept: (id: string) => void
  onResolve: (id: string) => void
}

/** The shared step-up-gated flow modals for the currently-active break. */
export interface ReconBreakFlowsProps {
  activeBreak: ReconBreakView
  flow: ReconFlowStep
  reason: string
  onClose: () => void
  /** Advance to the next stage (accept→confirm, resolve→engine). */
  onAdvance: (flow: ReconFlowStep) => void
  /** Capture the audited reason before the confirm/engine leg. */
  onCaptureReason: (reason: string) => void
  /** Fire the real disposition mutation (step-up-gated). */
  onDisposition: (
    id: string,
    resolution: ReconBreakResolution,
    reason: string
  ) => void
}

// ─── Treasury page (design §6.13) ─────────────────────────────────────────────────
// The 4-up balance-card row is a mix of a real aggregated-custodial hero (from
// `useTreasuryBalances`) and design-faithful fiat-float / FX-position tiles (no
// dedicated endpoint yet). One descriptor drives every tile so the row renders
// uniformly.

/** How a balance tile is tinted — `hero` = the dark-green custodial gradient. */
export type TreasuryCardTone = "hero" | "neutral"

/** A resolved balance-card descriptor for the design's 4-up tile row. */
export interface TreasuryCard {
  /** Stable key + a11y label root (e.g. "custodial-usdt"). */
  id: string
  tone: TreasuryCardTone
  /** Eyebrow label ("Custodial · USDT"). */
  label: string
  /** The big mono/tabular figure. */
  value: string
  /** Health-dot semantic — drives the dot colour and reads with the note. */
  dot: "ok" | "warn" | "danger"
  /** Sub-note line under the dot. */
  note: string
  /** True when the figure comes from a live query; false = design-faithful. */
  live: boolean
}

/**
 * One child-address sweep row (design §6.13 "Child-address sweeps"). The backing
 * data is a withdrawal-policy's wallet id; on-chain balance + sweep status have no
 * endpoint yet, so those two fields are design-faithful representative content.
 */
export interface TreasurySweepRow {
  id: string
  /** The (truncated) child on-chain address, rendered mono. */
  addr: string
  /** Design-faithful on-chain balance (mono / tabular). */
  bal: string
  /** Sweep lifecycle label — drives the status dot + tinted label. */
  status: "Swept" | "Pending" | "Below threshold"
}

/**
 * One payout / withdrawal approval-queue row (design §6.13 markup lines 11). The
 * `big` flag renders the amber "Maker-checker" tag and routes Approve through the
 * dual-control flow (maker-checker → step-up); non-big rows go straight to step-up.
 */
export interface TreasuryPayoutRow {
  id: string
  /** Beneficiary / destination line (13px/700). */
  to: string
  /** Withdrawal reference (mono, part of the "ref · method" sub-line). */
  ref: string
  /** Rail / method label (the second half of the sub-line). */
  method: string
  /** The payout amount (mono / tabular, 13.5px/800). */
  amt: string
  /** Large payout → shows the "Maker-checker" tag + dual-control approve path. */
  big: boolean
}

/** One balance tile — the hero variant carries the dark-green gradient. */
export interface BalanceCardProps {
  card: TreasuryCard
}

/** The 4-up balance-card row — error / loading / data over `BalanceCard`. */
export interface BalanceCardsRowProps {
  cards: TreasuryCard[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** The threshold-breach warning banner (composes the shared acknowledge control). */
export interface TreasuryAlertBannerProps {
  alert: import("@handshake-agent/contracts").TreasuryAlert
}

/** The payout / withdrawal approval queue — loading / error / empty / data. */
export interface PayoutQueuePanelProps {
  payouts: TreasuryPayoutRow[]
  isLoading: boolean
  isError: boolean
  /** Which rows have already been approved this session (shows "Requested"). */
  approved: Record<string, boolean>
  onRetry: () => void
  onApprove: (row: TreasuryPayoutRow) => void
}

/** The child-address sweeps panel — loading / error / empty / data + threshold footer. */
export interface SweepsPanelProps {
  sweeps: TreasurySweepRow[]
  threshold: string
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** The beneficiaries-in-cooling-off panel (composes the shared step-up override). */
export interface CoolingOffPanelProps {
  beneficiaries: import("@handshake-agent/contracts").AdminBeneficiary[]
}

// ─── Agent config page (design §6.17 Agent config) ──────────────────────────────

/** One "Model & guardrails" key/value row (design §6.17). */
export interface AgentGuardrailRow {
  label: string
  value: string
}

/**
 * One "System-prompt versions" row (design §6.17). No prompt-version endpoint
 * exists — the contract surfaces only a single read-only preview string — so
 * these rows are design-faithful representative content shaped exactly like the
 * design markup (dot + version + tag + meta + a maker-checker action link).
 */
export interface AgentPromptVersion {
  /** Semantic version label (mono). */
  version: string
  /** The lifecycle tag rendered beside the version ("live" / "staged" / …). */
  tag: string
  /** Author + timestamp metadata line. */
  meta: string
  /** The status-dot tone — drives the design's coloured dot. */
  tone: "success" | "warn" | "muted"
  /** The right-aligned action label ("View diff" / "Promote" / "Rollback"). */
  action: string
}

/** A tool-registry capability's access class — read-only tools vs proposal tools. */
export type AgentToolKind = "read" | "write"

/**
 * One "Tool registry" row (design §6.17). The live tool set is not exposed by an
 * admin endpoint, so these rows are design-faithful and mirror the agent's actual
 * typed tool surface (read-only tools return data; "write" tools only PROPOSE,
 * they never execute — §3.1).
 */
export interface AgentToolRow {
  /** Fully-qualified tool name (mono). */
  name: string
  /** read = read-only data tool · write = proposal-only tool (never executes). */
  kind: AgentToolKind
}

/** One "Cost & usage (24h)" key/value row (design §6.17). */
export interface AgentUsageStat {
  label: string
  value: string
}

// ─── Notifications & comms page (design §6.18) ──────────────────────────────────────
// No broadcast / delivery-log endpoint exists yet, so the composer's audience and
// schedule options and the delivery log are design-faithful: these shapes describe
// the component's local sample content, not a contracts DTO. (The TEMPLATE select
// is wired to the real notification-templates hook when it resolves.)

/** A broadcast composer <select> option (audience cohort / schedule). */
export interface BroadcastOption {
  value: string
  label: string
}

/**
 * The delivery channel a broadcast went out on — selects the channel chip's
 * status-token color pair (WhatsApp=success, Email=info, SMS=warn, In-app=neutral).
 */
export type DeliveryChannel = "WhatsApp" | "Email" | "SMS" | "In-app"

/**
 * A delivery-log entry's terminal state — selects the trailing status pill's
 * status-token color pair (Delivered/Sent=success, Queued/Scheduled=info,
 * Sending=warn, Bounced/Failed=danger).
 */
export type DeliveryStatus =
  | "Delivered"
  | "Sent"
  | "Queued"
  | "Scheduled"
  | "Sending"
  | "Bounced"
  | "Failed"

/** One row in the read-only delivery log (channel chip + name + meta + status pill). */
export interface DeliveryLogRow {
  id: string
  channel: DeliveryChannel
  /** The broadcast / template name (bold ink). */
  name: string
  /** The targeted cohort label (e.g. "tier_1 users"). */
  audience: string
  /** Relative or absolute send time. */
  time: string
  status: DeliveryStatus
}

// ─── Asset catalog page (design §6.23) ──────────────────────────────────────────────
// The console has no dedicated admin asset-catalog endpoint. The layered catalog
// config (`useSettings("Catalog")`) surfaces enablement flags as flat dot-path leaves,
// not the structured per-asset rows the design's table needs (chain / decimals /
// min-max / contract). So the asset table is design-faithful representative content
// matching launch reality (USDT + TRX on TRON, ADR-0006); each row's `live` state is
// resolved from the real catalog config where a matching capability leaf exists, else
// left as its design-faithful default. The "Sync Blockradar catalog" action and the
// "Newly discovered" review card have no endpoint either — read-only / design-faithful.

/**
 * One asset row in the catalog table (design §6.23). Mirrors the backend
 * `CatalogAsset` shape (symbol / displayName / decimals / networks) plus the
 * per-asset min-max + on-chain contract the design surfaces. Representative
 * content — see the page-level comment.
 */
export interface AssetCatalogRow {
  /** Ticker rendered in the green chip + bold cell (e.g. "USDT"). */
  sym: string
  /** Human display name shown under the ticker (e.g. "Tether USD"). */
  name: string
  /** Settlement network label (mono, e.g. "TRON · TRC-20"). */
  chain: string
  /** On-chain decimals (mono / tabular). */
  dec: number
  /** Per-transaction min / max, pre-formatted (mono / tabular). */
  minmax: string
  /** On-chain contract address (mono, click-to-copy); "—" for a native asset. */
  contract: string
  /**
   * Provider-discovered logo URL (Blockradar Cloudinary), or null → the tinted
   * text-badge fallback renders. A public asset image, never a secret.
   */
  logo: string | null
  /**
   * Whether the asset is enabled in the live catalog. Resolved from the real
   * catalog config when a matching capability leaf exists; else design-faithful.
   */
  live: boolean
}

/**
 * TableFilterBar props — the filter/search strip rendered inside a table card's
 * header. `children` are the page-specific controls; `className` tweaks the strip.
 */
export interface TableFilterBarProps {
  children: import("react").ReactNode
  className?: string
}

/**
 * AssetLogo primitive props. Renders the provider logo image when a `logoUrl` is
 * supplied and loads; on a missing URL or an image load error it falls back to the
 * `sym` text badge. `className` styles the container (size, rounding, background,
 * and — for the fallback — the text color/size, which the symbol inherits).
 */
export interface AssetLogoProps {
  /** The asset ticker shown as the fallback badge text (e.g. "USDT"). */
  sym: string
  /** Absolute logo URL, or null when none was discovered. */
  logoUrl: string | null
  /** Container styling (size + rounding + background + fallback text classes). */
  className?: string
}

// The "Newly discovered" card (design §6.23) is now WIRED to the real GET
// /admin/config/assets/discovered read and maps `AdminDiscoveredAsset` from
// `@handshake-agent/contracts` directly — so it no longer needs a local row type here.

// ─── Templates page (design §6.19) ──────────────────────────────────────────────────
// The Templates screen is WIRED to the real GET /admin/notification-templates
// endpoint (Phase 6a) and maps the contract's `NotificationTemplate` directly onto
// each card, so it no longer needs local design-faithful card types here. The
// design's approval pill has no backing contract field and is omitted (recorded as a
// shape gap for a later backend-enrichment pass).

// ─── Currency catalog page (design §6.24) ───────────────────────────────────────────
// Design-reproduction: the table renders the design's OWN mock currency seed
// (`docs/design-ref/logic.js` `currencies`, lines 126-130) so the screen looks
// exactly like `docs/design-ref/screens/Currencies.html`. Real-data reintegration is
// a separate later step. Each row's Live pill is a maker-checker toggle (enabling /
// disabling a currency is a dual-control config change) — clicking it opens the
// shared MakerCheckerModal, matching the design's `onToggle` destination. Nothing
// here moves money (§3.1).

/** A currency-catalog row for the design §6.24 table (mirrors the design seed). */
export interface CurrencyCatalogRow {
  /** Stable row id (from the design seed, e.g. "ngn") — used as the React key. */
  id: string
  /** ISO currency code (e.g. "NGN"), rendered bold. */
  code: string
  /** Display symbol (e.g. "₦"), shown in the chip and the Symbol column (mono). */
  symbol: string
  /** Full currency name (e.g. "Nigerian Naira"). */
  name: string
  /** Rounding precision in decimal places (design seed `rounding`). */
  rounding: number
  /** Whether bank name-enquiry is available for this currency (design seed `ne`). */
  nameEnquiry: boolean
  /** Whether the currency is live (enabled) — drives the Live pill (design seed `live`). */
  live: boolean
  /**
   * True for a runtime admin-added currency (CustomFiat) — toggled via the currency
   * endpoint; false for a built-in catalog fiat — toggled via the settings key. Drives
   * the "custom" chip + which mutation the Live toggle calls.
   */
  custom: boolean
}

// ─── Ticketing page (design §6.21) ──────────────────────────────────────────────────
// Left panel = Vendor ports; right panel = Recent orders. This is a DESIGN
// REPRODUCTION (docs/design-ref/screens/Ticketing.html) — no data is fetched. Both
// panels render the design's own representative sample content (module-level consts,
// matching the seed() dataset shapes + operator/vendor names). Real-data reintegration
// is a separate later step. Nothing here moves money (§3.1).

/** A recent-order row's payment status → the canonical status pill (§5 map). */
export type TicketOrderStatus =
  | "settled"
  | "pending_settlement"
  | "refunded"
  | "failed"

/**
 * One "Recent orders" row (design §6.21). Design-reproduction sample content shaped
 * exactly like the design markup (event name + mono order id · user · amount · status
 * pill). The row navigates to the transaction detail route, matching the design's
 * clickable-record affordance.
 */
export interface TicketOrderRow {
  /** The event/ticket title (bold ink, 12.5px). */
  event: string
  /** The mono order / transaction id (also the navigation target). */
  id: string
  /** The buyer's display name (design seed, e.g. "Amara Okeke"). */
  user: string
  /** The order amount, pre-formatted (mono / tabular). */
  amt: string
  status: TicketOrderStatus
}

// ─── Pricing page (design §6.22) ────────────────────────────────────────────────────
// Per capability × asset × currency (design table: Capability · Asset/ccy · Spread ·
// Fee · Min/max · Effective-rate-preview · Edit). REAL data comes from
// `useSettings("Pricing")`: each priced asset contributes a Buy row (from
// `pricing.assets.<A>.buySpreadBps`) and a Sell row (from `…sellSpreadBps`), with the
// base rate (`…baseRates.NGN`) and the global processing fee (`pricing.processingFeeBps`).
// The effective-rate preview + operator-only margin are DERIVED from those real values
// (never a stored line item — root §3.1). Per-capability min/max has no dedicated config
// key, so that one cell is design-faithful representative content.

/** A pricing row's capability — selects the Buy vs Sell spread key + rate direction. */
export type PricingCapability = "crypto.buy" | "crypto.sell"

/**
 * One resolved row of the pricing table (design §6.22). The bps/rate figures are real
 * (resolved from the pricing settings); `spread` is the underlying editable
 * `pricing.assets.<asset>.<buy|sell>SpreadBps` setting the Edit action patches (via
 * step-up + maker-checker). `minmax` is design-faithful (no per-capability cap key yet).
 */
export interface PricingRow {
  /** Stable key + a11y root, e.g. "USDT-crypto.buy". */
  id: string
  capability: PricingCapability
  /** The money-path asset (USDT / BTC / TRX). */
  asset: string
  /** The fiat pairing rendered under the capability (e.g. "USDT / NGN"). */
  pair: string
  /** The editable spread setting backing this row (bps), if the value resolved. */
  spread: EffectiveSetting | null
  /** The global processing-fee setting shared across rows (bps). */
  fee: EffectiveSetting | null
  /** The asset's mid-market base-rate setting (NGN per 1 unit). */
  baseRate: EffectiveSetting | null
  /** design-faithful: no per-capability min/max config key yet. */
  minmax: string
}

export interface PricingRowActionsProps {
  /** The resolved row whose spread the Edit action patches. */
  row: PricingRow
  /** Whether the signed-in operator may write config (drives Edit vs read-only). */
  canEdit: boolean
}

/**
 * One configured base rate — a mid-market `<code>`-per-1-`<asset>` price resolved from
 * `pricing.assets.<asset>.baseRates.<code>`. A currency is fail-closed on enablement
 * until at least one such rate exists (root §7), so this is the "add prices" surface.
 */
export interface PricingBaseRateRow {
  /** Stable row id + a11y anchor, e.g. "USDT-GHS". */
  id: string
  /** The priced asset (USDT / BTC / TRX). */
  asset: string
  /** The fiat code the rate is denominated in (e.g. "GHS"). */
  code: string
  /** The editable base-rate setting key this row patches. */
  key: string
  /** The current rate (fiat units per 1 asset). */
  value: number
  /** Pre-formatted rate label (e.g. "19.5 GHS"). */
  label: string
  /** The setting's scope + scopeValue, carried so the write targets its leaf. */
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/** An (asset, currency) pair that has no base rate yet — offered in the Add-price dialog. */
export interface AddPriceOption {
  asset: string
  code: string
}

export interface PricingBaseRatesProps {
  /** Configured base rates (value present), in display order. */
  rows: PricingBaseRateRow[]
  /** Whether any unpriced (asset, currency) pair remains to add. */
  canAdd: boolean
  /** Loading branch (settings still resolving). */
  loading: boolean
  /** Edit an existing base rate (opens the shared audit chain). */
  onEdit: (row: PricingBaseRateRow) => void
  /** Open the Add-price dialog. */
  onAdd: () => void
}

export interface AddPriceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Unpriced (asset, currency) pairs the operator may add a rate for. */
  options: AddPriceOption[]
  /** Hand the captured (asset, currency, rate) up to start the audit chain. */
  onContinue: (choice: { asset: string; code: string; rate: number }) => void
}

/** The two priced, fiat-denominated capabilities that carry per-row MIN/MAX bounds. */
export type PricingCap = "buy" | "sell"

/** The generalized pricing edit chain: value → reason → step-up → maker-checker → PATCH. */
export type PricingFlowStep = "value" | "reason" | "stepup" | "maker"

/** One resolved spread row (buy or sell) of the design's pricing grid. */
export interface SpreadRow {
  id: string
  cap: string
  pair: string
  spread: string
  fee: string
  userRate: string
  margin: string
  spreadKey: string
  spreadBps: number | null
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  /** Per-(capability × asset × currency) fiat MIN/MAX (the pricing MIN/MAX column). */
  dir: PricingCap
  asset: string
  currency: string
  minKey: string
  maxKey: string
  minValue: number | null
  maxValue: number | null
}

/**
 * A single numeric-pricing edit in flight — the generalized target the audit chain
 * patches. `format` renders the value for the diff/toast; `integer` restricts the
 * captured value (bps are whole; a base rate may be a decimal).
 */
export interface EditTarget {
  key: string
  title: string
  fieldLabel: string
  currentLabel: string
  seed: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  diffField: string
  toastLabel: string
  format: (n: number) => string
  integer: boolean
}

/** One body row of the spread grid — including the inline Edit + min/max controls. */
export interface SpreadTableRowProps {
  row: SpreadRow
  onEdit: (row: SpreadRow) => void
  onEditMin: (row: SpreadRow) => void
  onEditMax: (row: SpreadRow) => void
}

/** The spread card — preview-currency + fee header strip, then the 7-column grid. */
export interface SpreadCardProps {
  rows: SpreadRow[]
  currencies: string[]
  previewCurrency: string
  feeLabel: string
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  onCurrencyChange: (currency: string) => void
  onRetry: () => void
  onEditFee: () => void
  onEdit: (row: SpreadRow) => void
  onEditMin: (row: SpreadRow) => void
  onEditMax: (row: SpreadRow) => void
}

// ─── Capabilities / service registry page (design §6.25) ─────────────────────────
// PIXEL reproduction of `docs/design-ref/screens/Capabilities.html`: the master
// switchboard. Each transactable capability is bound to a provider port and rendered
// as a full-width kill-switch row — icon tile + mono label + ENABLED/DISABLED status
// pill + desc·port + a 52px soft toggle. This is a design reproduction: the rows are
// the design's own module-level mock content (the seed `caps` array, logic.js lines
// 113-120), no fetching / TanStack Query. Toggling opens the shared MakerCheckerModal
// (kill-switch = maker-checker) exactly as the design does.

/** The icon-tile tint for a capability row → a status-token surface/text pair. */
export type CapabilityTone = "success" | "info" | "warn" | "neutral"

/**
 * One capability switchboard row — the design's `caps` seed shape (logic.js 113-120).
 * `label` is the mono capability id; `provider` is the bound provider port; `on` is the
 * current enablement; `icon` is the 24×24 stroke path; `tone` tints the icon tile.
 */
export interface CapabilityRow {
  /** Stable row id (the design's `caps[].id`, also the mono label). */
  id: string
  /** The mono capability label shown in the switchboard row. */
  label: string
  /** One-line description of what the capability enables. */
  desc: string
  /** The bound provider port name. */
  provider: string
  /** Current enablement (drives the pill label + toggle position). */
  on: boolean
  /** The icon-tile tint token pair. */
  tone: CapabilityTone
  /** The 24×24 stroke-1.8 SVG `path` `d` for the row's icon tile. */
  icon: string
}

/**
 * One capability switchboard row's props: the row data joined with its toggle handler.
 * Toggling never flips the switch directly — it opens the maker-checker modal.
 */
export interface CapabilityRowProps {
  /** The capability row's design-faithful content. */
  row: CapabilityRow
  /** Fired when the operator flips the kill-switch (opens maker-checker). */
  onToggle: (row: CapabilityRow) => void
}

/**
 * Per-capability display metadata the config contract does NOT provide — the human
 * label, description, bound provider port, icon path, and tint. Keyed by the crypto
 * capability leaf; `on` is NOT here (it comes from the live setting value).
 */
export interface CapabilityPresentation {
  /** The `catalog.capabilities.crypto.<x>` registry key backing this row. */
  settingKey: string
  label: string
  desc: string
  provider: string
  tone: CapabilityTone
  icon: string
}

/**
 * A resolved capability row plus the registry key + scope that back it — carried so
 * the write path targets the same leaf the read resolved.
 */
export interface ResolvedCapability extends CapabilityRow {
  settingKey: string
  scope: import("@handshake-agent/contracts").EffectiveSetting["scope"]
  scopeValue: string | null
}

// ─── Settings page (layered-config console, design §6.30) ────────────────────────────

/** The config layer a key resolved from — `db` (an admin override) vs env/JSON baseline. */
export type SettingSource = "DB" | "Baseline"

/** The settings edit chain: value → reason → step-up → maker-checker → PATCH. */
export type SettingsFlowStep = "value" | "reason" | "stepup" | "maker" | null

/** One design-reproduction settings row, mapped from a real `EffectiveSetting`. */
export interface SettingRow {
  key: string
  /** The resolved effective value, formatted (mono / tabular). */
  val: string
  /** The winning config layer — 'DB' for an override, else 'Baseline' (env/JSON). */
  src: SettingSource
  /** The value's type — shown in the key meta line (`valueType`). */
  type: string
  /** The registry `valueType` — drives the value-entry control + coercion. */
  valueType: EffectiveSetting["valueType"]
  desc: string
  /** A human resolution line for the source chip tooltip. */
  chain: readonly string[]
  /** Whether the row is editable from the console (DB-layer keys only). */
  editable: boolean
  /** The raw effective value, used to seed the value-entry control. */
  rawValue: unknown
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
}

/** One body row of the settings grid. */
export interface SettingsTableRowProps {
  row: SettingRow
  onEdit: (row: SettingRow) => void
}

/** The settings table card — header + loading / error / empty / data. */
export interface SettingsTableProps {
  rows: SettingRow[]
  totalCount: number
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  search: string
  onRetry: () => void
  onEdit: (row: SettingRow) => void
}

/** The value-entry modal (step 0 of the edit chain). */
export interface SettingValueModalProps {
  open: boolean
  row: SettingRow | null
  onOpenChange: (open: boolean) => void
  onContinue: (value: unknown, display: string) => void
}

/** The value-entry form body — mounted only while open so it seeds from `row`. */
export interface SettingValueFormProps {
  row: SettingRow
  onContinue: (value: unknown, display: string) => void
}

// ─── WhatsApp page (design §6.20) ────────────────────────────────────────────────────
// PIXEL reproduction of `docs/design-ref/screens/Whatsapp.html`: this screen is a
// pure design reproduction (no `useWhatsAppConfig` / TanStack Query). Its content is
// the design's own representative sample data — `waHealth` (key/val + per-row colour),
// `waFlows` (lock rows + Live pills) and `waConvo` (redacted chat bubbles) — embedded
// as module-level constants. The secret VALUES never cross the boundary (root
// CLAUDE.md §3.5): the health rows carry presence/status, never a plaintext secret.

/** One "Number & webhook health" key/value row (design `waHealth` `{k, v, fg}`). */
export interface WhatsAppHealthRow {
  /** The row label (e.g. "Graph version", "App secret"). */
  label: string
  /** The rendered value (mono) — an id/version or "Set" / "Not set" for secrets. */
  value: string
  /**
   * Health tone — drives the mono value's text token (design per-row `fg`). `ok` =
   * present/healthy (`text-tok`), `warn` = a secret that isn't set / degraded
   * (`text-twn`), `neutral` = a plain wiring value (`text-ink`).
   */
  tone: "ok" | "warn" | "neutral"
}

// ─── Limits & velocity page (design §6.26) ─────────────────────────────────────────
// DESIGN REPRODUCTION (markup docs/design-ref/screens/Limits.html): tier tabs +
// two cards ("Amount caps · {tier}" | "Velocity & counts · {tier}"). The rows are
// the design's own mock content (per-tier NGN caps + counts), not fetched. Editing
// an amount cap is maker-checker — it opens the shared reason → step-up → maker-
// checker flow modals. Real-data reintegration is a separate, later step.

/** The three NGN KYC tiers the registry enumerates (`limits.NGN.<tier>.*`). */
export type LimitTierId = "tier_1" | "tier_2" | "tier_3"

/**
 * How a limit leaf's value is formatted + parsed: a fiat amount (rendered in the
 * selected currency), a plain count, or a duration in seconds. Drives the display
 * string, the edit field label, and the diff.
 */
export type LimitLeafKind = "amount" | "count" | "seconds"

/**
 * The setting leaf backing an editable limit row — its full key + scope (so the write
 * targets the same leaf the read resolved) + its value kind. Present ONLY on rows whose
 * config key exists AND is enforced server-side; a row without one is display-only (a
 * placeholder cap the engine does not enforce is never made editable — root §3.6).
 */
export interface LimitEditLeaf {
  key: string
  scope: EffectiveSetting["scope"]
  scopeValue: string | null
  kind: LimitLeafKind
}

/** One "Amount caps" key/value row (edit pencil opens the maker-checker flow). */
export interface LimitAmountRow {
  /** The cap label shown on the left (e.g. "Per-transaction max"). */
  k: string
  /** The cap value shown on the right (mono/tabular, e.g. "₦200,000"). */
  v: string
  /** Present when the row is backed by an enforced, editable config leaf. */
  edit?: LimitEditLeaf
}

/** One "Velocity & counts" key/value row. Editable when backed by an enforced leaf. */
export interface LimitVelocityRow {
  /** The metric label shown on the left (e.g. "Transactions / day"). */
  k: string
  /** The metric value shown on the right (mono/tabular, e.g. "10"). */
  v: string
  /** Present when the row is backed by an enforced, editable config leaf. */
  edit?: LimitEditLeaf
}

/** A tier tab's full content — its amount caps and velocity/count rows. */
export interface LimitTier {
  id: LimitTierId
  /** The tab label + card suffix (e.g. "Tier 1"). */
  label: string
  amountCaps: readonly LimitAmountRow[]
  velocity: readonly LimitVelocityRow[]
}

// ─── System / ops page (design §6.29) ────────────────────────────────────────
// Three sections: a 5-up provider status tile grid, a "Webhook queues" list, and a
// "Background jobs & cron" list. There is NO operational-status endpoint yet, so the
// whole screen is design-faithful representative content shaped exactly like the
// design. It is read-only oversight — nothing here moves money (§3.1). The "Run now"
// affordance wires to the SAME shared flow modals the design opens for an operational
// action: reason (audit) → step-up (TOTP) → engine-action. Triggering a background job
// is engine-brokered — never a raw side-effect from this surface — so the flow encodes
// that invariant in the UI even though there is no live endpoint yet.

/**
 * A health status → the canonical status token pair (§5). `ok` = healthy (green),
 * `warn` = degraded/backed-up (amber), `down` = failing/erroring (red).
 */
export type OpsHealth = "ok" | "warn" | "down"

/** One provider status tile (dot + name + latency + status label). */
export interface OpsProviderTile {
  /** Provider display name (e.g. "Blockradar"). */
  name: string
  /** Round-trip / probe latency label (mono, tabular-nums; e.g. "142ms"). */
  latency: string
  /** Short status label rendered in the health-toned text (e.g. "Operational"). */
  status: string
  /** Drives the dot + status-label colour tokens. */
  health: OpsHealth
}

/** One "Webhook queues" row (mono name + depth/retries meta + status label). */
export interface OpsWebhookQueue {
  /** The queue's mono identifier (e.g. "blockradar.deposit"). */
  name: string
  /** Current queue depth (tabular-nums). */
  depth: number
  /** In-flight retry count (tabular-nums). */
  retries: number
  /** Short status label in the health-toned text (e.g. "Draining"). */
  status: string
  /** Drives the status-label colour token. */
  health: OpsHealth
}

/** One "Background jobs & cron" row (name + schedule/last meta + status pill + Run now). */
export interface OpsJobRow {
  /** Stable key + flow identifier (e.g. "reconciliation-sweep"). */
  id: string
  /** The job's display name (e.g. "Reconciliation sweep"). */
  name: string
  /** Cron-expression / cadence label (mono). */
  schedule: string
  /** Relative "last ran" label (mono; e.g. "3m ago"). */
  last: string
  /** Short status label rendered inside the status pill (e.g. "Healthy"). */
  status: string
  /** Drives the status-pill surface + text token pair. */
  health: OpsHealth
}

/** The stage the active "Run now" flow is showing. */
export type OpsRunStage = "reason" | "engine"

/** A wallet-backfill run's lifecycle status. */
export type BackfillStatus = "queued" | "running" | "completed" | "failed"

/** The 5-up provider status tiles (contract-sourced). */
export interface ProviderTilesProps {
  providers: import("@handshake-agent/contracts").OpsProviderStatus[]
}

/** The webhook-queues panel (contract-sourced rows). */
export interface WebhookQueuesCardProps {
  queues: import("@handshake-agent/contracts").OpsWebhookQueue[]
}

/** The background-jobs panel — each job carries a step-up-gated "Run now". */
export interface BackgroundJobsCardProps {
  jobs: OpsJobRow[]
  onRun: (job: OpsJobRow) => void
}

/** One service-health row (success/error rate + status word). */
export interface ServiceHealthRowProps {
  service: import("@handshake-agent/contracts").ServiceHealthMetrics["services"][number]
}

/** The shared "Run now" flow modals (reason → engine-action) for the active job. */
export interface OpsRunFlowProps {
  job: OpsJobRow
  stage: OpsRunStage
  onClose: () => void
  /** Reason (audit) captured → advance to the engine-action leg. */
  onContinue: (reason: string) => void
  onExecute: () => void
}

// ─── Providers page (design §6.27) ──────────────────────────────────────────────────
// Provider adapter cards + a mock→live readiness checklist, WIRED to the real
// provider-registry read endpoint (GET /admin/providers, Phase 6b). The card/
// readiness data shapes are contract-owned (`ProviderCardView` /
// `ProviderReadinessItem` from `@handshake-agent/contracts`) — this file keeps only
// the presentational prop type. The screen is READ-ONLY: the API returns
// secret-PRESENCE booleans, never key values (§3.4/§3.5), so there is no reveal of
// any real secret; "Test connection" / key reveal are Phase 7. Nothing moves money
// (§3.1). Status → pill token pair: ok=success, degraded=warn, down=danger,
// mock=info — colour is never the sole signal (the status word carries the state).

export interface ProviderCardViewProps {
  /** The provider adapter card this row renders (contract-owned shape). */
  provider: import("@handshake-agent/contracts").ProviderCardView
}

/** Props for the ProviderTestButton (the Phase-7 "Test connection" liveness probe). */
export interface ProviderTestButtonProps {
  /** The stable provider key to probe (e.g. "blockradar"). */
  providerKey: string
}

// ─── Approvals page (design §6 Approvals, `screens/Approvals.html`) ──────────────

/**
 * The change class of a dual-control request — drives the kind pill's tint
 * (info / warn / success) and reads alongside its label so colour is never the
 * sole signal.
 */
export type ApprovalKind =
  | "Pricing change"
  | "Capability"
  | "Refund"
  | "Tier override"
  | "KYC decision"
  | "Manual credit"

/**
 * One from→to field change inside a maker-checker request. The `from` is struck
 * through in danger-tone, the `to` shown in success-tone (design diff row).
 */
export interface ApprovalDiffRow {
  /** The changed field's label (e.g. "crypto.buy · USDT/NGN spread"). */
  field: string
  /** Previous value (rendered struck-through, danger tone). */
  from: string
  /** Proposed value (rendered success tone). */
  to: string
}

/**
 * A pending dual-control request in the approval inbox. This is design-faithful
 * representative content — there is no approvals endpoint yet — so the requester
 * is identified by their originating role (`byRole`), which the design uses to
 * derive "your own request" (a request raised by your own role needs a different
 * admin), while the target / reason / diff mirror the design's seed items.
 */
export interface ApprovalRequest {
  /** Stable id + a11y anchor (design's `apr_5001` mono id). */
  id: string
  kind: ApprovalKind
  /** One-line summary of the change. */
  title: string
  /** Requester's display name. */
  by: string
  /** The role that raised the request — drives the "your own request" guard. */
  byRole: string
  /** Relative timestamp ("34m ago"). */
  ago: string
  /** The console area the change targets ("Pricing", "Capabilities", …). */
  resource: string
  /** The maker's stated justification (shown in the reason box). */
  reason: string
  /** The itemized from→to changes this request would apply. */
  diff: ApprovalDiffRow[]
}

// ─── Shared flow modals (design template §5 "Flow modals", lines 1161-1259) ─────────
// The funds-safety flow modals share one frame (fixed scrim rgba(10,20,15,0.55)
// + blur, centred radius-20 panel, flow shadow, hsPop). Each is opened by a caller
// (`open` + `onOpenChange`) and takes the design's per-step content props. They are
// pure presentation — they do NOT move money; a real callsite wires their submit to a
// mutation. Built on the shared Dialog primitive (focus-trap + Esc close).

/** The reserved fixed panel widths per flow step (design `flowWidth`, line 420). */
export type FlowModalWidth = "440px" | "520px"

/** A base shape every flow modal shares: open-state + a required action title. */
export interface FlowModalBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The action being authorized (interpolated into the modal copy). */
  title: string
}

/**
 * ReasonModal (design line 1166) — blue document icon, "recorded in the immutable
 * audit log" copy, reason-category chips, a required free-text reason, Cancel /
 * Continue. `onContinue` receives the entered reason + selected category.
 */
export interface ReasonModalProps extends FlowModalBaseProps {
  /** Called with the captured reason once a non-empty reason is entered. */
  onContinue: (reason: string, category: string) => void
  /** Override the reason-category chips (defaults to the design's five). */
  categories?: readonly string[]
}

/**
 * StepUpModal (design line 1182) — dark-green lock, six TOTP digit boxes (active box
 * amber border), an on-screen keypad, Cancel. `onComplete` fires with the 6-digit
 * code once all boxes fill.
 */
export interface StepUpModalProps extends FlowModalBaseProps {
  /** Called with the assembled 6-digit code when the last box fills. */
  onComplete: (code: string) => void
}

/** One "Itemized effect" key/value row in the engine-action modal. */
export interface EngineEffectRow {
  /** The effect label (left, muted). */
  k: string
  /** The effect value (right, mono/tabular, bold). */
  v: string
}

/** One "Ledger entries to be written" row in the engine-action modal. */
export interface EngineLedgerRow {
  /** The double-entry account (mono). */
  acct: string
  /** Direction — `DR` (debit) tints danger, `CR` (credit) tints success. */
  dir: "DR" | "CR"
  /** The signed amount (right, mono/tabular). */
  amt: string
}

/**
 * EngineActionModal (design line 1198) — green "executed by the settlement engine"
 * banner, an itemized-effect table, a ledger-entries table, a dashed idempotency-key
 * box, Cancel / amber execute CTA. `onExecute` fires when the amber CTA is pressed.
 */
export interface EngineActionModalProps extends FlowModalBaseProps {
  /** The itemized effect rows shown before execution. */
  effect: EngineEffectRow[]
  /** The double-entry rows the engine will write. */
  ledger: EngineLedgerRow[]
  /** The idempotency key that guards this execution (mono; copyable). */
  idempotencyKey: string
  /** The amber CTA label (defaults to "Execute via engine"). */
  cta?: string
  /** Fired when the operator presses the execute CTA. */
  onExecute: () => void
}

/**
 * ManualCreditModal — the input step for a manual wallet credit (Phase 7 WRITE).
 * Collects the asset (from the user's live wallet assets) + a positive amount, then
 * hands them to the flow via `onContinue`. It is presentation only: it moves no money
 * (the engine-brokered credit runs only after reason → step-up → maker-checker →
 * approval by a SECOND admin, §3.1). The Continue CTA activates only for a valid,
 * positive amount.
 */
export interface ManualCreditModalProps extends FlowModalBaseProps {
  /** The assets the operator can credit (the user's live wallet assets). */
  assets: readonly string[]
  /** Called with the chosen asset + entered amount once both are valid. */
  onContinue: (asset: string, amount: string) => void
}

/** One from→to diff row in the maker-checker modal. */
export interface MakerCheckerDiffRow {
  /** The changed field's label. */
  field: string
  /** The current value (struck-through, danger tone). */
  from: string
  /** The proposed value (success tone). */
  to: string
}

/**
 * MakerCheckerModal (design line 1214) — amber shield icon, "enters Pending approval"
 * copy, a from→to change-preview table, Cancel / dark "Submit for approval".
 * `onSubmit` fires when the dark CTA is pressed.
 */
export interface MakerCheckerModalProps extends FlowModalBaseProps {
  /** The itemized change preview (from→to per field). */
  diff: MakerCheckerDiffRow[]
  /** Fired when the operator submits for a second admin's approval. */
  onSubmit: () => void
}

// ─── Shared UI primitives (design §5) ──────────────────────────────────────────────

/** A KpiCard delta chip's tone → the token pair driving its surface + text. */
export type KpiDeltaTone = "success" | "warn"

/**
 * KpiCard (design §5 "KPI stat card") — a labelled stat tile. `hero` renders the
 * dark-green brand gradient (white ink, amber-on-deep delta chip); a normal tile uses
 * the `--card` surface with a success/warn delta chip.
 */
export interface KpiCardProps {
  /** The stat label (12px/600). */
  label: string
  /** The big value (26px/800, tabular). */
  value: string
  /** Optional delta chip text (e.g. "+12.4%"). */
  delta?: string
  /** Optional muted note after the delta (e.g. "vs prior"). */
  deltaNote?: string
  /** Tile 0 → dark-green hero (white ink, amber delta chip). */
  hero?: boolean
  /** Non-hero tiles: use the warn (amber) delta pair instead of success. */
  tone?: KpiDeltaTone
}

// ─── Operator dashboard ──────────────────────────────────────────────────────────

/** The KPI-range switcher presets (design `kpiRanges`). */
export type DashboardRangeId = "24h" | "7d" | "30d"

/** One derived KPI tile (feeds `KpiCard`). */
export interface DashboardKpi {
  label: string
  value: string
  delta: string
  deltaNote: string
  hero?: boolean
  tone?: KpiDeltaTone
}

/** One System-health provider row (dot + halo + right-aligned status colour). */
export interface DashboardHealthRow {
  name: string
  note: string
  /** Right-aligned status label — observed latency ("120ms") or "—". */
  status: string
  dot: string
  halo: string
  /** Right-aligned status colour token. */
  fg: string
}

/** One Live-activity feed row (icon + tint + text/meta/time). */
export interface DashboardActivityItem {
  text: string
  meta: string
  time: string
  /** Inline SVG path (design `a.icon`). */
  icon: string
  iconBg: string
  iconFg: string
}

/** Dashboard header — the title + the 24h/7d/30d range switcher. */
export interface DashboardHeaderProps {
  range: DashboardRangeId
  onRangeChange: (range: DashboardRangeId) => void
}

/** The 4×2 KPI-tile grid, rendered from the real composite summary. */
export interface KpiGridProps {
  data: import("@handshake-agent/contracts").DashboardSummary
  /** Open compliance count from the ops endpoint (undefined while loading/forbidden). */
  openComplianceCases: number | undefined
}

/** The Transaction-volume chart card — real stacked-by-capability series. */
export interface VolumeChartCardProps {
  data: import("@handshake-agent/contracts").DashboardSummary | undefined
  isLoading: boolean
}

/** Shared props for the ops-endpoint cards (System health + Live activity). */
export interface DashboardOpsCardProps {
  ops: import("@handshake-agent/contracts").MetricsOps | undefined
  isLoading: boolean
  isError: boolean
}

export interface FilterSelectProps extends Omit<
  ComponentPropsWithoutRef<"select">,
  "children"
> {
  /** Accessible label (rendered as `aria-label` — the design has no visible label). */
  label: string
  /** The `{ value, label }` options rendered as `<option>`s. */
  options: readonly { value: string; label: string }[]
}

export interface PaginationProps {
  /** Total number of records across all pages (drives the "of Z" count). */
  total: number
  /** Number of records per page. */
  pageSize: number
  /** The current 1-based page. */
  page: number
  /** Change handler — receives the requested 1-based page. */
  onPageChange: (page: number) => void
  /** Optional max-width applied to the pulled-up bar (defaults to full width). */
  maxWidth?: string
}

/**
 * The canonical status strings the console renders → one semantic pill. Maps the
 * design's `stMeta` / `kycMeta` keys (logic.js lines 496/593/687/699/1829). Colour is
 * never the sole signal — the pill's label carries the state.
 */
export type StatusPillStatus =
  // stMeta (transactions / ledger)
  | "settled"
  | "pending_settlement"
  | "failed"
  | "refunded"
  | "refund"
  | "quoted"
  | "initiated"
  | "receive"
  // kycMeta (KYC / users)
  | "verified"
  | "pending"
  | "needs_info"
  | "rejected"

export interface StatusPillProps {
  /** The status string to map onto a semantic pill. */
  status: StatusPillStatus
  /** Override the rendered label (defaults to the status's canonical label). */
  label?: string
  /** Adds a pulsing `currentColor` dot for a "stuck" pending status (design line 605). */
  stuck?: boolean
}

/** One stacked capability segment in a ChartBars column (design §5 stacked bars). */
export type ChartBarCapability = "buy" | "sell" | "send" | "swap" | "ticket"

/** One bar in ChartBars: a label + the five capability values (any unit; normalised). */
export interface ChartBar {
  /** The bar's axis label / tooltip (e.g. "Jun 18"). */
  label: string
  /** The five capability segment values, index-aligned to the legend order. */
  segments: Record<ChartBarCapability, number>
}

export interface ChartBarsProps {
  /** The bars to render (left→right). */
  bars: ChartBar[]
  /** Accessible summary (rendered as the chart's `aria-label`). */
  ariaLabel: string
  /** Whether to render the 5-capability legend above the bars (default true). */
  showLegend?: boolean
}
