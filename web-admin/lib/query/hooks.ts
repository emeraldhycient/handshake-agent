/**
 * TanStack Query hooks — the admin data layer.
 *
 * All hooks call the typed clients in `lib/api/admin.ts` and use the `qk` key
 * factory. This file lives in `lib/` and must NOT import from `components/` or
 * `app/`. Mutations invalidate the queries they affect.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  AdminCustomFiatCreateRequest,
  AdminCustomFiatUpdateRequest,
  AdminEndUserSearchQuery,
  AdminEndUserStatusRequest,
  AdminEndUserTierRequest,
  CreateManualCreditRequest,
  AdminInvitationCreateRequest,
  AdminLedgerListQuery,
  AdminOpsRunRequest,
  AdminTxnMarkFailedRequest,
  AdminTxnSearchQuery,
  AdminPreferencesUpdateRequest,
  BackfillNetworksRequest,
  AdminUserStatusRequest,
  AdminUserUpdateRoleRequest,
  AdminUserNoteCreateRequest,
  AmlRuleCreateRequest,
  AmlRuleUpdateRequest,
  ApplyUserTagsRequest,
  BlockedEntryCreateRequest,
  AuditLogQuery,
  BroadcastSendRequest,
  BulkMessageRequest,
  ComplianceDispositionRequest,
  ComplianceReportDraftRequest,
  ComplianceReportSubmitRequest,
  CreateChangeRequest,
  KycApproveRequest,
  KycRejectRequest,
  KycStatus,
  MetricsRangeQuery,
  NotificationTemplatePreviewRequest,
  NotificationTemplateUpsertRequest,
  ReconAcceptRequest,
  ReconResolveRequest,
  RejectChangeRequest,
  RoleCreateRequest,
  RoleUpdateRequest,
  SanctionsDispositionRequest,
  TreasuryAlertAcknowledgeRequest,
  TreasuryPayoutApproveRequest,
  UpdateSettingRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import * as agent from "@/lib/api/agent"
import * as approvals from "@/lib/api/approvals"
import * as beneficiaries from "@/lib/api/beneficiaries"
import * as blocked from "@/lib/api/blocked"
import * as assets from "@/lib/api/assets"
import * as catalog from "@/lib/api/catalog"
import * as config from "@/lib/api/config"
import * as currencies from "@/lib/api/currencies"
import * as compliance from "@/lib/api/compliance"
import * as kyc from "@/lib/api/kyc"
import * as ledger from "@/lib/api/ledger"
import * as metrics from "@/lib/api/metrics"
import * as ops from "@/lib/api/ops"
import * as notifications from "@/lib/api/notifications"
import * as providers from "@/lib/api/providers"
import * as reconciliation from "@/lib/api/reconciliation"
import * as tickets from "@/lib/api/tickets"
import * as transactions from "@/lib/api/transactions"
import * as treasury from "@/lib/api/treasury"
import * as users from "@/lib/api/users"
import * as whatsapp from "@/lib/api/whatsapp"
import type { ComplianceEventQuery } from "@/lib/api/compliance"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import type { TemplateRef } from "@/lib/api/notifications"
import type { NavBadgeCounts } from "@/types/components"
import { qk } from "./keys"

// ─── Read hooks ─────────────────────────────────────────────────────────────────

/**
 * The signed-in admin's resolved identity + effective RBAC grants. Drives nav
 * and page gating. Short staleTime — grants can change under the operator.
 */
export function useAdminMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => admin.getMe(),
    staleTime: 60_000,
    retry: false,
  })
}

/** All admin users. Refreshed on focus; 30 s stale. */
export function useAdmins() {
  return useQuery({
    queryKey: qk.admins,
    queryFn: () => admin.listAdmins(),
    staleTime: 30_000,
  })
}

/** All roles (built-in + custom). 5 min stale — roles change rarely. */
export function useRoles() {
  return useQuery({
    queryKey: qk.roles,
    queryFn: () => admin.listRoles(),
    staleTime: 5 * 60_000,
  })
}

/** The permission catalog. Effectively static for a deploy — long staleTime. */
export function usePermissions() {
  return useQuery({
    queryKey: qk.permissions,
    queryFn: () => admin.listPermissions(),
    staleTime: 30 * 60_000,
  })
}

/** Filtered, paginated audit log. Keyed by the query so filters re-fetch. */
export function useAudit(query: AuditLogQuery) {
  return useQuery({
    queryKey: qk.audit(query),
    queryFn: () => admin.listAudit(query),
    staleTime: 15_000,
  })
}

/** The current admin's sessions. 15 s stale. */
export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => admin.listSessions(),
    staleTime: 15_000,
  })
}

/**
 * The effective, non-secret catalog (enabled fiats / assets / networks +
 * capability flags) from `GET /config`. Drives the Currency + Asset catalog
 * screens. 5 min stale — the catalog changes only via admin config edits.
 */
export function usePublicConfig() {
  return useQuery({
    queryKey: qk.publicConfig,
    queryFn: () => config.getPublicConfig(),
    staleTime: 5 * 60_000,
  })
}

/**
 * The FULL asset + fiat catalog (enabled AND disabled) with each entry's live
 * status, from `GET /admin/config/catalog`. Drives the Asset + Currency catalog
 * screens — unlike `usePublicConfig` (enabled-only, secret-stripped), this admin
 * view shows the paused/off rows too. 5 min stale — the catalog changes only via
 * admin config edits.
 */
export function useAdminCatalog() {
  return useQuery({
    queryKey: qk.adminCatalog,
    queryFn: () => catalog.getAdminCatalog(),
    staleTime: 5 * 60_000,
  })
}

/**
 * The effective layered-config settings (GET /admin/settings) — every non-secret
 * registry key with its effective value + provenance. An optional `category`
 * narrows the list (e.g. "Pricing", "KYC", "Catalog"). Drives the Settings /
 * Pricing / Limits / Capabilities / Flags console screens. 60 s stale — config
 * changes only via admin edits.
 */
export function useSettings(category?: string) {
  return useQuery({
    queryKey: qk.settings(category),
    queryFn: () => config.listEffectiveSettings(category),
    staleTime: 60_000,
  })
}

/** One registry key's effective value + provenance. Disabled until a `key` is set. */
export function useSetting(key: string | null) {
  return useQuery({
    queryKey: qk.setting(key ?? ""),
    queryFn: () => config.getSetting(key as string),
    enabled: key !== null,
    staleTime: 60_000,
  })
}

/** Search / filter / paginate the platform's end users. Keyed by the query. */
export function useEndUsers(query: AdminEndUserSearchQuery) {
  return useQuery({
    queryKey: qk.endUsers(query),
    queryFn: () => users.listEndUsers(query),
    staleTime: 15_000,
  })
}

/** One end user's full aggregate (identity + devices + balances + history). */
export function useEndUserDetail(id: string | null) {
  return useQuery({
    queryKey: qk.endUser(id ?? ""),
    queryFn: () => users.getEndUser(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's bound/revoked devices. */
export function useEndUserDevices(id: string | null) {
  return useQuery({
    queryKey: qk.endUserDevices(id ?? ""),
    queryFn: () => users.listEndUserDevices(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's active + recent auth sessions (detail Security tab). */
export function useEndUserSessions(id: string | null) {
  return useQuery({
    queryKey: qk.endUserSessions(id ?? ""),
    queryFn: () => users.listEndUserSessions(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's effective limits + live velocity usage (detail Limits tab). */
export function useEndUserLimits(id: string | null) {
  return useQuery({
    queryKey: qk.endUserLimits(id ?? ""),
    queryFn: () => users.getEndUserLimits(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's admin-action timeline from the audit log (detail Profile tab). */
export function useEndUserTimeline(id: string | null) {
  return useQuery({
    queryKey: qk.endUserTimeline(id ?? ""),
    queryFn: () => users.listEndUserTimeline(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's immutable case notes. Disabled until an `id` is set. */
export function useUserNotes(id: string | null) {
  return useQuery({
    queryKey: qk.userNotes(id ?? ""),
    queryFn: () => users.listUserNotes(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/**
 * The KYC review queue for a status bucket (defaults to pending_review). The
 * status is part of the key so each console tab caches its own bucket. 15 s stale.
 */
export function useKycQueue(status?: KycStatus) {
  return useQuery({
    queryKey: qk.kycQueue(status),
    queryFn: () => kyc.listKycQueue(status ? { status } : {}),
    staleTime: 15_000,
  })
}

/** One KYC submission's reviewable detail (last-4 PII only). */
export function useKycSubmission(userId: string | null) {
  return useQuery({
    queryKey: qk.kycSubmission(userId ?? ""),
    queryFn: () => kyc.getKycSubmission(userId as string),
    enabled: userId !== null,
    staleTime: 15_000,
  })
}

// ─── Transactions + ledger read hooks ─────────────────────────────────────────────

/** Search / filter / paginate the engine's transactions. Keyed by the query. */
export function useTransactions(query: AdminTxnSearchQuery) {
  return useQuery({
    queryKey: qk.transactions(query),
    queryFn: () => transactions.listTransactions(query),
    staleTime: 15_000,
  })
}

/** One transaction's detail (ledger legs + lifecycle timeline). */
export function useTransactionDetail(id: string | null) {
  return useQuery({
    queryKey: qk.transaction(id ?? ""),
    queryFn: () => transactions.getTransaction(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** An account's posted ledger entries. Disabled until the account triple is set. */
export function useLedgerHistory(query: LedgerHistoryQuery | null) {
  return useQuery({
    queryKey: qk.ledgerHistory(
      query ?? { accountType: "", accountId: "", currency: "" }
    ),
    queryFn: () => ledger.listLedgerHistory(query as LedgerHistoryQuery),
    enabled: query !== null,
    staleTime: 15_000,
  })
}

/**
 * The GLOBAL cross-account ledger, filtered by an optional accountType/currency,
 * newest-first. Keyset-paginated ("Load more" via `nextCursor`): each page's
 * cursor is fed into the next request's `params.cursor`. `filters` excludes the
 * cursor — it seeds page one and keys the cache.
 */
export function useGlobalLedger(filters: AdminLedgerListQuery) {
  return useInfiniteQuery({
    queryKey: qk.ledgerGlobal(filters),
    queryFn: ({ pageParam }) =>
      ledger.listGlobalLedger({
        ...filters,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 15_000,
  })
}

/** The global ledger sequence-integrity summary (header pill). 30 s stale. */
export function useLedgerIntegrity() {
  return useQuery({
    queryKey: qk.ledgerIntegrity,
    queryFn: () => ledger.getLedgerIntegrity(),
    staleTime: 30_000,
  })
}

// ─── Compliance read hooks ────────────────────────────────────────────────────────

/** The flagged-event queue. Keyed by the filter. */
export function useComplianceEvents(query: ComplianceEventQuery) {
  return useQuery({
    queryKey: qk.complianceEvents(query),
    queryFn: () => compliance.listComplianceEvents(query),
    staleTime: 15_000,
  })
}

/** One compliance event's detail (raw screening payload + disposition note). */
export function useComplianceEvent(id: string | null) {
  return useQuery({
    queryKey: qk.complianceEvent(id ?? ""),
    queryFn: () => compliance.getComplianceEvent(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The immutable sanctions screening-run history. */
export function useSanctions() {
  return useQuery({
    queryKey: qk.sanctions,
    queryFn: () => compliance.listSanctions(),
    staleTime: 30_000,
  })
}

/** The sanctions ongoing-monitoring policy flags (read-only; from layered config). */
export function useSanctionsMonitoring() {
  return useQuery({
    queryKey: qk.sanctionsMonitoring,
    queryFn: () => compliance.getSanctionsMonitoring(),
    staleTime: 60_000,
  })
}

/** The admin-tunable AML engine rules. 30 s stale. */
export function useAmlRules() {
  return useQuery({
    queryKey: qk.amlRules,
    queryFn: () => compliance.listAmlRules(),
    staleTime: 30_000,
  })
}

/** Qualifying-transfer Travel-Rule capture (read-only). */
export function useTravelRule() {
  return useQuery({
    queryKey: qk.travelRule,
    queryFn: () => compliance.listTravelRule(),
    staleTime: 30_000,
  })
}

/** SAR/STR compliance reports. */
export function useComplianceReports() {
  return useQuery({
    queryKey: qk.complianceReports,
    queryFn: () => compliance.listComplianceReports(),
    staleTime: 15_000,
  })
}

// ─── Treasury read hooks ──────────────────────────────────────────────────────────

/** Aggregated custodial balances by network + asset. */
export function useTreasuryBalances() {
  return useQuery({
    queryKey: qk.treasuryBalances,
    queryFn: () => treasury.listTreasuryBalances(),
    staleTime: 15_000,
  })
}

/** Real-time exposure-vs-limit snapshots. */
export function useTreasuryExposure() {
  return useQuery({
    queryKey: qk.treasuryExposure,
    queryFn: () => treasury.listTreasuryExposure(),
    staleTime: 15_000,
  })
}

/** Exposure-threshold breach alerts. */
export function useTreasuryAlerts() {
  return useQuery({
    queryKey: qk.treasuryAlerts,
    queryFn: () => treasury.listTreasuryAlerts(),
    staleTime: 15_000,
  })
}

/** Active per-wallet withdrawal policies (read-only). */
export function useWithdrawalPolicies() {
  return useQuery({
    queryKey: qk.withdrawalPolicies,
    queryFn: () => treasury.listWithdrawalPolicies(),
    staleTime: 60_000,
  })
}

/** Child-address gas-sweep state (balance + lifecycle) + the sweep threshold. */
export function useTreasurySweeps() {
  return useQuery({
    queryKey: qk.treasurySweeps,
    queryFn: () => treasury.listTreasurySweeps(),
    staleTime: 30_000,
  })
}

/** Pending payouts / withdrawals awaiting release (read-only). */
export function useTreasuryPayoutQueue() {
  return useQuery({
    queryKey: qk.treasuryPayoutQueue,
    queryFn: () => treasury.listTreasuryPayoutQueue(),
    staleTime: 15_000,
  })
}

/** NGN fiat float vs the configured target. */
export function useTreasuryFiatFloat() {
  return useQuery({
    queryKey: qk.treasuryFiatFloat,
    queryFn: () => treasury.listTreasuryFiatFloat(),
    staleTime: 30_000,
  })
}

/** FX net position + exposure headroom. */
export function useTreasuryFxPosition() {
  return useQuery({
    queryKey: qk.treasuryFxPosition,
    queryFn: () => treasury.listTreasuryFxPosition(),
    staleTime: 30_000,
  })
}

// ─── Reconciliation (Phase 6b — READ-ONLY) ────────────────────────────────────────

/** Provider-vs-ledger break list (over-credit / missing-settlement / mismatch / dup). */
export function useReconBreaks() {
  return useQuery({
    queryKey: qk.reconBreaks,
    queryFn: () => reconciliation.listReconBreaks(),
    staleTime: 30_000,
  })
}

/** Reconciliation-cron status bar (last/next run, enablement, open-break count). */
export function useReconStatus() {
  return useQuery({
    queryKey: qk.reconStatus,
    queryFn: () => reconciliation.getReconStatus(),
    staleTime: 30_000,
  })
}

/** End-user beneficiaries (payout destinations), optionally scoped to a user. */
export function useAdminBeneficiaries(userId?: string) {
  return useQuery({
    queryKey: qk.adminBeneficiaries(userId),
    queryFn: () => beneficiaries.listBeneficiaries(userId),
    staleTime: 15_000,
  })
}

/** The deny-list (blocked users / addresses / banks; active + superseded). */
export function useBlockedList() {
  return useQuery({
    queryKey: qk.blocked,
    queryFn: () => blocked.listBlocked(),
    staleTime: 30_000,
  })
}

// ─── Approvals inbox (Phase 7, maker-checker) ──────────────────────────────────────

/**
 * The maker-checker approvals inbox — the two caller-relative buckets (awaiting me /
 * my requests) + their counts. Backs the Approvals page tabs/badges and the
 * dashboard's "Approvals awaiting me" panel count. 15 s stale — the queue moves as
 * makers raise and checkers dispose of requests.
 */
export function useApprovalsInbox() {
  return useQuery({
    queryKey: qk.approvalsInbox,
    queryFn: () => approvals.getApprovalsInbox(),
    staleTime: 15_000,
  })
}

/** The unfiltered transactions query whose response `counts` feed the stuck badge. */
const NAV_BADGE_TXN_QUERY: AdminTxnSearchQuery = {}

/**
 * Live counts for the sidebar nav-item alert pips — replaces the design's mock
 * counts (§4.1). Composes four existing read hooks (no new endpoint): the KYC
 * review-queue depth, the stuck-transaction count, open reconciliation breaks,
 * and maker-checker requests awaiting the caller. Each source is independently
 * cached (15 s); a source that is still loading or errored contributes `0`, so
 * the pip simply doesn't show rather than flashing a stale number.
 *
 * The KYC count is the current review-queue page length — a floor, not a total;
 * an operator queue deeper than one page under-counts, which is acceptable for an
 * alert pip and avoids a bespoke count endpoint.
 */
export function useNavBadges(): NavBadgeCounts {
  const kyc = useKycQueue()
  const txns = useTransactions(NAV_BADGE_TXN_QUERY)
  const recon = useReconStatus()
  const approvalsInbox = useApprovalsInbox()
  return {
    kyc: kyc.data?.items.length ?? 0,
    stuck: txns.data?.counts.stuck ?? 0,
    recon: recon.data?.openBreakCount ?? 0,
    approvals: approvalsInbox.data?.counts.awaitingMe ?? 0,
  }
}

// ─── Mutation hooks ─────────────────────────────────────────────────────────────

export function useCreateInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AdminInvitationCreateRequest) =>
      admin.createInvitation(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useUpdateAdminRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminUserUpdateRoleRequest
    }) => admin.updateAdminRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useSetAdminStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminUserStatusRequest
    }) => admin.setAdminStatus(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useCreateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RoleCreateRequest) => admin.createRole(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.roles })
    },
  })
}

export function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RoleUpdateRequest }) =>
      admin.updateRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.roles })
    },
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => admin.revokeSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.sessions })
    },
  })
}

export function useVerifyAuditChain() {
  return useMutation({
    mutationFn: () => admin.verifyAuditChain(),
  })
}

// ─── Layered-config (AppSetting) mutation ─────────────────────────────────────────
// Applying an admin override to a tunable key (root CLAUDE.md §7). Sensitive: the
// PATCH is step-up-guarded server-side and may 403 with ADMIN_STEP_UP_REQUIRED (the
// caller wraps it in `useStepUpRetry`). The server re-validates, hot-reloads, and
// records an immutable `config_change` audit entry; it never moves money (§3.1). On
// success it invalidates the settings prefix so the list + the single-key cache
// re-resolve with the new effective value + 'db' provenance.

export function useSetSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      input,
    }: {
      key: string
      input: UpdateSettingRequest
    }) => config.setSetting(key, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
    },
  })
}

/**
 * POST /admin/config/currencies — add a runtime currency ("Add currency"). Refreshes
 * the admin catalog so the Currency-catalog screen shows the new (disabled) row.
 * Step-up-gated server-side — the caller wraps in useStepUpRetry.
 */
export function useAddCurrency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AdminCustomFiatCreateRequest) =>
      currencies.addCurrency(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminCatalog })
    },
  })
}

/**
 * PATCH /admin/config/currencies/:code — enable/disable or edit a runtime currency.
 * Enabling without pricing is rejected server-side (422). Refreshes the catalog.
 */
export function useUpdateCurrency() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      code,
      patch,
    }: {
      code: string
      patch: AdminCustomFiatUpdateRequest
    }) => currencies.updateCurrency(code, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.adminCatalog })
    },
  })
}

/**
 * GET /admin/config/assets/discovered — the newly-discovered (Blockradar) assets awaiting
 * review on the Asset-catalog screen.
 */
export function useDiscoveredAssets() {
  return useQuery({
    queryKey: qk.discoveredAssets,
    queryFn: assets.listDiscoveredAssets,
    staleTime: 60_000,
  })
}

/**
 * POST /admin/config/assets/sync — trigger a Blockradar catalog re-sync. Step-up-gated
 * server-side (the caller wraps in useStepUpRetry). Refreshes the discovered list + the
 * admin catalog (a sync can bring new assets into the tradeable overlay).
 */
export function useSyncAssets() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: assets.syncAssets,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.discoveredAssets })
      void queryClient.invalidateQueries({ queryKey: qk.adminCatalog })
    },
  })
}

// ─── End-user mutations ───────────────────────────────────────────────────────────
// Each is sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps it in
// `useStepUpRetry`). On success they invalidate the user's queries so the detail
// + list re-resolve. `["admin", "users"]` is a prefix match covering the list,
// detail, and devices keys.

export function useAdjustTier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminEndUserTierRequest
    }) => users.adjustTier(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useSetUserStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminEndUserStatusRequest
    }) => users.setEndUserStatus(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useForcePinReset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => users.forcePinReset(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// Raise a MANUAL-CREDIT request for a user's wallet — a MAKER action (four-eyes,
// §3.1). It moves NO money from this surface: it enters a pending change request a
// SECOND admin approves (which routes the engine-brokered credit). May 403 with
// ADMIN_STEP_UP_REQUIRED. On success it invalidates the approvals inbox (the new
// request appears) and the users prefix (the pending credit shows on the detail).
export function useRequestManualCredit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: CreateManualCreditRequest
    }) => users.requestManualCredit(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useRevokeDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deviceId }: { id: string; deviceId: string }) =>
      users.revokeDevice(id, deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useSimSwapReverify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => users.simSwapReverify(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// ─── Phase 9 end-user mutations — notes / verification / re-KYC / sessions ─────────
// None moves money (§3.4/§3.1). The step-up-gated ones (force-re-KYC, session
// revocation) may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps them in
// `useStepUpRetry`. Each invalidates the reads it affects.

/** Append an immutable case note. Invalidates the notes list + the user timeline. */
export function useCreateUserNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminUserNoteCreateRequest
    }) => users.createUserNote(id, input),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: qk.userNotes(id) })
      void queryClient.invalidateQueries({ queryKey: qk.endUserTimeline(id) })
    },
  })
}

/** Re-send the user's verification email/link. Low-risk — reason optional. */
export function useResendVerification() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      users.resendVerification(id, reason),
  })
}

/**
 * Force the user back through KYC. Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED).
 * Invalidates the users prefix so the detail (KYC pill/tier) re-resolves.
 */
export function useForceReKyc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      users.forceReKyc(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

/**
 * Revoke ONE of the user's auth sessions. Sensitive (may 403 with
 * ADMIN_STEP_UP_REQUIRED). Invalidates the user's sessions list.
 */
export function useRevokeUserSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      sessionId,
      reason,
    }: {
      id: string
      sessionId: string
      reason: string
    }) => users.revokeUserSession(id, sessionId, reason),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: qk.endUserSessions(id) })
    },
  })
}

/**
 * Revoke ALL of the user's auth sessions (force sign-out). Sensitive (may 403
 * with ADMIN_STEP_UP_REQUIRED). Invalidates the user's sessions list.
 */
export function useRevokeAllUserSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      users.revokeAllUserSessions(id, reason),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: qk.endUserSessions(id) })
    },
  })
}

// ─── Users bulk-bar mutations (Phase 7, WRITES) ─────────────────────────────────────
// Bulk actions over an EXPLICIT selected id set. Neither moves money (§3.1): a tag is
// a pure annotation; a message enqueues onto the notifications outbox (never a direct
// send). Both are sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps in
// `useStepUpRetry`), idempotent, and immutably audited. On success they invalidate the
// users prefix so the directory re-resolves.

// Bulk-apply an operator tag to the selection. Idempotent (re-tagging is a no-op).
export function useApplyUserTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ApplyUserTagsRequest) => users.applyUserTags(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// Bulk-queue a templated broadcast to the selection. A large set may 422 with
// ADMIN_BULK_CONFIRMATION_REQUIRED until the operator confirms (`confirmLargeSet`).
export function useSendBulkMessage() {
  return useMutation({
    mutationFn: (input: BulkMessageRequest) => users.sendBulkMessage(input),
  })
}

// ─── KYC-review mutations ─────────────────────────────────────────────────────────
// Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED). On success they invalidate the
// queue and the reviewed submission so both re-resolve.

export function useApproveKyc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string
      input: KycApproveRequest
    }) => kyc.approveKyc(userId, input),
    onSuccess: () => {
      // The queue/submission and the reviewed user's detail (header KYC pill/tier)
      // both change on a decision — invalidate both prefixes so each re-resolves.
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useRejectKyc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string
      input: KycRejectRequest
    }) => kyc.rejectKyc(userId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

/**
 * Bounce a KYC review back to the user for more info (Phase 9). Sensitive (may
 * 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps in `useStepUpRetry`). On
 * success it invalidates the KYC queue (the submission leaves pending_review) and
 * the users prefix (the detail's KYC pill re-resolves).
 */
export function useRequestKycInfo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      kyc.requestKycInfo(userId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// ─── Approvals (maker-checker) mutations ────────────────────────────────────────────
// The checker's disposition of a pending change request. Both are sensitive (may 403
// with ADMIN_STEP_UP_REQUIRED — the caller wraps in `useStepUpRetry`) and audited;
// approving hands the recorded change to the target service to APPLY, rejecting
// applies nothing. Neither moves money from this surface (§3.1). On success they
// invalidate the inbox so both buckets + counts re-resolve.

// The maker raising a pending change request (e.g. a `refund` of a stuck txn).
// APPLIES NOTHING — it enters the inbox for a SECOND admin to approve (four-eyes),
// so it never moves money from this surface (§3.1). Sensitive (may 403 with
// ADMIN_STEP_UP_REQUIRED). On success it invalidates the inbox so both buckets +
// counts re-resolve, and the transactions prefix so the drilled-in detail can
// reflect the pending-refund request.
export function useCreateChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateChangeRequest) => approvals.createChange(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
      void queryClient.invalidateQueries({
        queryKey: ["admin", "transactions"],
      })
    },
  })
}

export function useApproveChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => approvals.approveChange(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
    },
  })
}

export function useRejectChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RejectChangeRequest }) =>
      approvals.rejectChange(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
    },
  })
}

// ─── Transaction-triage mutations ─────────────────────────────────────────────────
// Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps in
// `useStepUpRetry`). On success they invalidate the transactions prefix so the
// list + detail re-resolve.

export function useMarkFailed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminTxnMarkFailedRequest
    }) => transactions.markTransactionFailed(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "transactions"],
      })
    },
  })
}

export function useRetrySettlement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => transactions.retryTransaction(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "transactions"],
      })
    },
  })
}

// ─── Ledger mutation ──────────────────────────────────────────────────────────────
// Verify is read-only on the server (re-sums legs) but modelled as a mutation
// since it's an explicit on-demand action; it invalidates nothing.

export function useVerifyLedger() {
  return useMutation({
    mutationFn: (transactionId: string) => ledger.verifyLedger(transactionId),
  })
}

// ─── Compliance mutations ─────────────────────────────────────────────────────────
// Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED). On success they invalidate the
// compliance prefix so the affected list/detail re-resolve.

export function useDisposeEvent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: ComplianceDispositionRequest
    }) => compliance.disposeComplianceEvent(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "compliance"] })
    },
  })
}

// The operator's disposition of a sanctions screening match (Clear / Escalate /
// Block). Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps in
// `useStepUpRetry`); the server writes the disposition annotation (never the
// immutable verdict, §3.1) and records an immutable `admin_review` audit. On success
// it invalidates the sanctions list so the disposed match re-resolves.
export function useDisposeSanctions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: SanctionsDispositionRequest
    }) => compliance.disposeSanctions(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.sanctions })
    },
  })
}

export function useCreateAmlRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AmlRuleCreateRequest) =>
      compliance.createAmlRule(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.amlRules })
    },
  })
}

export function useUpdateAmlRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AmlRuleUpdateRequest }) =>
      compliance.updateAmlRule(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.amlRules })
    },
  })
}

export function useDraftReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ComplianceReportDraftRequest) =>
      compliance.draftComplianceReport(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.complianceReports })
    },
  })
}

export function useSubmitReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: ComplianceReportSubmitRequest
    }) => compliance.submitComplianceReport(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.complianceReports })
    },
  })
}

// ─── Treasury + beneficiary mutations ─────────────────────────────────────────────
// Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED). On success they invalidate
// their prefix so the affected list re-resolves.

export function useAcknowledgeAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: TreasuryAlertAcknowledgeRequest
    }) => treasury.acknowledgeTreasuryAlert(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.treasuryAlerts })
    },
  })
}

export function useOverrideCoolingOff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => beneficiaries.overrideCoolingOff(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "beneficiaries"],
      })
    },
  })
}

/**
 * Admin-remove a saved payout destination (Phase 9). Sensitive (may 403 with
 * ADMIN_STEP_UP_REQUIRED — the caller wraps in `useStepUpRetry`); moves no money
 * (§3.1). On success it invalidates the beneficiaries prefix (the destination
 * leaves the list) and the users prefix (the user detail re-resolves).
 */
export function useRemoveBeneficiary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      beneficiaries.removeBeneficiary(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin", "beneficiaries"],
      })
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// ─── Phase 9 blocked-entry (deny-list) mutations ──────────────────────────────────
// A blocked entry gates a subject out of the money path; the list is append-only
// (lifting SUPERSEDES rather than deletes, §3.4). Both are sensitive (may 403 with
// ADMIN_STEP_UP_REQUIRED — the caller wraps in `useStepUpRetry`) and move no money
// (§3.1). Each invalidates the blocked list so it re-resolves.

export function useAddBlocked() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BlockedEntryCreateRequest) => blocked.addBlocked(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.blocked })
    },
  })
}

export function useSupersedeBlocked() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      blocked.supersedeBlocked(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.blocked })
    },
  })
}

// ─── Phase 7 WRITES — Ops / Recon / Treasury / Providers ──────────────────────────
// All sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps in
// `useStepUpRetry`). None moves money directly (§3.1): the ops run re-drives an
// engine worker; a recon resolve re-enqueues settlement via the engine; a payout
// approve raises a four-eyes change request; a provider test is a liveness probe.
// On success each invalidates the affected read so the surface re-resolves.

/** POST /admin/ops/jobs/:id/run — trigger a manual job run; refreshes the ops board. */
export function useRunOpsJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AdminOpsRunRequest }) =>
      ops.runOpsJob(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.opsBoard })
    },
  })
}

/** POST /admin/reconciliation/breaks/:id/resolve — engine-brokered break resolve. */
export function useResolveReconBreak() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReconResolveRequest }) =>
      reconciliation.resolveReconBreak(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reconBreaks })
      void queryClient.invalidateQueries({ queryKey: qk.reconStatus })
    },
  })
}

/** POST /admin/reconciliation/breaks/:id/accept — dual-control, no-debit accept. */
export function useAcceptReconBreak() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReconAcceptRequest }) =>
      reconciliation.acceptReconBreak(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reconBreaks })
      void queryClient.invalidateQueries({ queryKey: qk.reconStatus })
    },
  })
}

// ─── Phase 8: preferences · MFA reset · recon escalate/re-run · wallet backfill ──

/** GET /admin/me/preferences — the caller's own notification toggles (60s stale). */
export function useAdminPreferences() {
  return useQuery({
    queryKey: qk.adminPreferences,
    queryFn: () => admin.getAdminPreferences(),
    staleTime: 60_000,
  })
}

/** PATCH /admin/me/preferences — replace the caller's own toggles; caches the result. */
export function useUpdateAdminPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AdminPreferencesUpdateRequest) =>
      admin.updateAdminPreferences(input),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.adminPreferences, data)
    },
  })
}

/**
 * POST /admin/admins/:id/mfa/reset — reset ANOTHER admin's 2FA (step-up-gated; the
 * caller wraps in useStepUpRetry). Refreshes the admins list on success.
 */
export function useResetAdminMfa() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      admin.resetAdminMfa(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

/**
 * POST /admin/reconciliation/breaks/:id/escalate — open a compliance case from a
 * break (step-up-gated). Refreshes the break list + the compliance events.
 */
export function useEscalateReconBreak() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      reconciliation.escalateReconBreak(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.reconBreaks })
      void queryClient.invalidateQueries({
        queryKey: ["admin", "compliance", "events"],
      })
    },
  })
}

/** POST /admin/transactions/:id/reconcile — read-only re-run recon for one txn. */
export function useRerunReconciliation() {
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      transactions.rerunReconciliation(id, reason),
  })
}

/** POST /admin/wallets/backfill-networks — enqueue a wallet-network backfill run. */
export function useEnqueueBackfill() {
  return useMutation({
    mutationFn: (input: BackfillNetworksRequest) => ops.enqueueBackfill(input),
  })
}

/**
 * GET /admin/wallets/backfill-runs/:id — a run's live status. When `poll` is set,
 * refetch every 3s until the run reaches a terminal state (completed / failed).
 */
export function useBackfillRun(id: string | null, opts?: { poll?: boolean }) {
  return useQuery({
    queryKey: qk.backfillRun(id ?? ""),
    queryFn: () => ops.getBackfillRun(id as string),
    enabled: id !== null,
    refetchInterval: (query) => {
      if (opts?.poll !== true) return false
      const status = query.state.data?.status
      return status === "completed" || status === "failed" ? false : 3000
    },
  })
}

/**
 * POST /admin/treasury/payouts/:id/approve — raise a maker-checker payout approval.
 * Invalidates the payout queue AND the approvals inbox (the new request lands there).
 */
export function useApproveTreasuryPayout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: TreasuryPayoutApproveRequest
    }) => treasury.approveTreasuryPayout(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.treasuryPayoutQueue })
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
    },
  })
}

/** POST /admin/providers/:key/test — run a provider liveness probe (no invalidation). */
export function useTestProviderConnection() {
  return useMutation({
    mutationFn: (key: string) => providers.testProviderConnection(key),
  })
}

// ─── Notification-template read hooks (Phase 4) ───────────────────────────────────

/** All admin-editable notification templates. 30 s stale. */
export function useNotificationTemplates() {
  return useQuery({
    queryKey: qk.notificationTemplates,
    queryFn: () => notifications.listNotificationTemplates(),
    staleTime: 30_000,
  })
}

/**
 * The read-only delivery log (recent issued notifications + aggregate
 * bounce/complaint rates) for the Comms console. 15 s stale — delivery state moves
 * quickly. (Phase 6b Comms READ enrichment.)
 */
export function useDeliveryLog() {
  return useQuery({
    queryKey: qk.notificationDeliveryLog,
    queryFn: () => notifications.getDeliveryLog(),
    staleTime: 15_000,
  })
}

/** One template by its composite key. Disabled until a `ref` is provided. */
export function useNotificationTemplate(ref: TemplateRef | null) {
  return useQuery({
    queryKey: qk.notificationTemplate(
      ref ?? { templateKey: "", language: "", channel: "email" }
    ),
    queryFn: () => notifications.getNotificationTemplate(ref as TemplateRef),
    enabled: ref !== null,
    staleTime: 30_000,
  })
}

// ─── WhatsApp / tickets / agent read hooks (Phase 4) ──────────────────────────────

/** Non-secret WhatsApp Cloud-API / Flows wiring + secret-presence flags. */
export function useWhatsAppConfig() {
  return useQuery({
    queryKey: qk.whatsappConfig,
    queryFn: () => whatsapp.getWhatsAppConfig(),
    staleTime: 5 * 60_000,
  })
}

/**
 * The provider-registry view: per-provider status/mock-mode/secret-presence/
 * bound-capabilities + the mock→live readiness checklist. Non-secret; no key values.
 */
export function useProviderRegistry() {
  return useQuery({
    queryKey: qk.providerRegistry,
    queryFn: () => providers.getProviderRegistry(),
    staleTime: 60_000,
  })
}

/** Existing ticket orders (read-only). */
export function useTicketOrders() {
  return useQuery({
    queryKey: qk.ticketOrders,
    queryFn: () => tickets.listTicketOrders(),
    staleTime: 15_000,
  })
}

/** The embedded agent's resolved config + read-only prompt preview. */
export function useAgentConfig() {
  return useQuery({
    queryKey: qk.agentConfig,
    queryFn: () => agent.getAgentConfig(),
    staleTime: 60_000,
  })
}

/**
 * The agent's guardrails, tool registry, live prompt version, and REAL 24h usage
 * counts (no token/cost — the schema stores none). Backs the Agent console's four
 * cards. 60 s stale — guardrails/tools are effectively static; usage need not be
 * real-time.
 */
export function useAgentInsights() {
  return useQuery({
    queryKey: qk.agentInsights,
    queryFn: () => agent.getAgentInsights(),
    staleTime: 60_000,
  })
}

/** The conversation/intent log list. 15 s stale. */
export function useConversations() {
  return useQuery({
    queryKey: qk.conversations,
    queryFn: () => agent.listConversations(),
    staleTime: 15_000,
  })
}

/** One conversation's messages + replies. Disabled until an `id` is set. */
export function useConversation(id: string | null) {
  return useQuery({
    queryKey: qk.conversation(id ?? ""),
    queryFn: () => agent.getConversation(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

// ─── Metrics / dashboard read hook (Phase 5, FINAL) ───────────────────────────────

/**
 * The composite operational dashboard summary for a date range. The range is part
 * of the key, so changing the preset re-fetches a distinct cache entry. 60 s stale
 * — aggregations are expensive and need not be real-time. `retry: false` so a 403
 * (no Metrics grant) surfaces immediately for graceful degradation on the home page.
 */
export function useDashboardMetrics(range: MetricsRangeQuery) {
  return useQuery({
    queryKey: qk.dashboardMetrics(range),
    queryFn: () => metrics.getDashboardMetrics(range),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * The daily per-currency GMV / revenue / profit time-series for a date range —
 * feeds the operator revenue & profit trend chart. Range is part of the key.
 * 60 s stale (same cadence as the composite dashboard); `retry: false` so a 403
 * (no Metrics grant) surfaces immediately for graceful degradation.
 */
export function useMoneySeries(range: MetricsRangeQuery) {
  return useQuery({
    queryKey: qk.moneySeries(range),
    queryFn: () => metrics.getMoneySeriesMetrics(range),
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * The operational-health payload (system health, live-activity feed, open-compliance
 * count) for the dashboard's three formerly-mock panels. 30 s stale — these signals
 * shift more often than the aggregations. `retry: false` so a 403 (no Metrics grant)
 * degrades gracefully alongside the composite dashboard.
 */
export function useMetricsOps() {
  return useQuery({
    queryKey: qk.metricsOps,
    queryFn: () => metrics.getMetricsOps(),
    staleTime: 30_000,
    retry: false,
  })
}

/**
 * The "System / ops" board (provider status, webhook-ingest queues, background-
 * jobs / cron registry) for the ops screen. 30 s stale — these signals shift
 * more often than the dashboard aggregations. `retry: false` so a 403 (no
 * Metrics grant) degrades gracefully.
 */
export function useOps() {
  return useQuery({
    queryKey: qk.opsBoard,
    queryFn: () => ops.getOpsBoard(),
    staleTime: 30_000,
    retry: false,
  })
}

// ─── Notification-template mutations (Phase 4) ────────────────────────────────────
// Create (POST) and edit (PATCH) are sensitive (may 403 with
// ADMIN_STEP_UP_REQUIRED — the caller wraps in `useStepUpRetry`). On success they
// invalidate the templates prefix so the list + detail re-resolve. Preview is a
// pure render — no persistence, nothing to invalidate.

export function useUpsertTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      ref,
      input,
    }: {
      /** Present → PATCH an existing template; absent → POST (create). */
      ref: TemplateRef | null
      input: NotificationTemplateUpsertRequest
    }) =>
      ref
        ? notifications.updateNotificationTemplate(ref, input)
        : notifications.upsertNotificationTemplate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.notificationTemplates,
      })
    },
  })
}

/** Pure deterministic render of supplied content — returns the rendered text. */
export function usePreviewTemplate() {
  return useMutation({
    mutationFn: (input: NotificationTemplatePreviewRequest) =>
      notifications.previewNotificationTemplate(input),
  })
}

/**
 * Send (or queue-for-approval) a broadcast to an audience cohort (Phase 7). The
 * SERVER decides the disposition from the resolved cohort size: a small audience is
 * `dispatched` through the outbox now; a large audience is `queued_for_approval` as
 * a maker-checker request for a second admin (§3.5). Sensitive + high-impact — may
 * 403 with ADMIN_STEP_UP_REQUIRED (the caller wraps in `useStepUpRetry`) and moves
 * no money (§3.1). On success it invalidates the delivery log (new outbox rows) and
 * the approvals inbox (a large-audience queue) so both re-resolve.
 */
export function useSendBroadcast() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: BroadcastSendRequest) =>
      notifications.sendBroadcast(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.notificationDeliveryLog,
      })
      void queryClient.invalidateQueries({ queryKey: qk.approvalsInbox })
    },
  })
}
