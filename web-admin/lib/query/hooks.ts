/**
 * TanStack Query hooks — the admin data layer.
 *
 * All hooks call the typed clients in `lib/api/admin.ts` and use the `qk` key
 * factory. This file lives in `lib/` and must NOT import from `components/` or
 * `app/`. Mutations invalidate the queries they affect.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminEndUserSearchQuery,
  AdminEndUserStatusRequest,
  AdminEndUserTierRequest,
  AdminInvitationCreateRequest,
  AdminTxnMarkFailedRequest,
  AdminTxnSearchQuery,
  AdminUserStatusRequest,
  AdminUserUpdateRoleRequest,
  AmlRuleCreateRequest,
  AmlRuleUpdateRequest,
  AuditLogQuery,
  ComplianceDispositionRequest,
  ComplianceReportDraftRequest,
  ComplianceReportSubmitRequest,
  KycApproveRequest,
  KycRejectRequest,
  MetricsRangeQuery,
  NotificationTemplatePreviewRequest,
  NotificationTemplateUpsertRequest,
  RoleCreateRequest,
  RoleUpdateRequest,
  TreasuryAlertAcknowledgeRequest,
  UpdateSettingRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import * as agent from "@/lib/api/agent"
import * as beneficiaries from "@/lib/api/beneficiaries"
import * as compliance from "@/lib/api/compliance"
import * as kyc from "@/lib/api/kyc"
import * as ledger from "@/lib/api/ledger"
import * as metrics from "@/lib/api/metrics"
import * as notifications from "@/lib/api/notifications"
import * as settings from "@/lib/api/settings"
import * as tickets from "@/lib/api/tickets"
import * as transactions from "@/lib/api/transactions"
import * as treasury from "@/lib/api/treasury"
import * as users from "@/lib/api/users"
import * as whatsapp from "@/lib/api/whatsapp"
import type { ComplianceEventQuery } from "@/lib/api/compliance"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import type { TemplateRef } from "@/lib/api/notifications"
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
 * Effective config settings for one category (or all). Keyed by category so each
 * tab caches independently. 30 s stale — DB overrides are hot-reloaded server-side.
 */
export function useSettings(category?: string) {
  return useQuery({
    queryKey: qk.settings(category),
    queryFn: () => settings.listSettings(category),
    staleTime: 30_000,
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

/** The KYC review queue. 15 s stale. */
export function useKycQueue() {
  return useQuery({
    queryKey: qk.kycQueue,
    queryFn: () => kyc.listKycQueue(),
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

/** End-user beneficiaries (payout destinations), optionally scoped to a user. */
export function useAdminBeneficiaries(userId?: string) {
  return useQuery({
    queryKey: qk.adminBeneficiaries(userId),
    queryFn: () => beneficiaries.listBeneficiaries(userId),
    staleTime: 15_000,
  })
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

/**
 * Update one config setting. On success invalidates every settings query (the
 * prefix match) so all category tabs re-resolve — a catalog flip can change a
 * sibling's effective state. The PATCH may 403 with ADMIN_STEP_UP_REQUIRED; the
 * caller wraps the mutation in `useStepUpRetry` to re-auth and retry.
 */
export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      input,
    }: {
      key: string
      input: UpdateSettingRequest
    }) => settings.updateSetting(key, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
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
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
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

// ─── Notification-template read hooks (Phase 4) ───────────────────────────────────

/** All admin-editable notification templates. 30 s stale. */
export function useNotificationTemplates() {
  return useQuery({
    queryKey: qk.notificationTemplates,
    queryFn: () => notifications.listNotificationTemplates(),
    staleTime: 30_000,
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
