/**
 * Query key factory — all TanStack Query keys for the admin app in one place.
 * Each key is a readonly tuple so consumers get stable references and
 * `invalidateQueries` can match precisely by prefix.
 */
import type {
  AdminEndUserSearchQuery,
  AdminTxnSearchQuery,
  AuditLogQuery,
  MetricsRangeQuery,
} from "@handshake-agent/contracts"

import type { ComplianceEventQuery } from "@/lib/api/compliance"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import type { TemplateRef } from "@/lib/api/notifications"

export const qk = {
  me: ["admin", "me"] as const,
  admins: ["admin", "admins"] as const,
  admin: (id: string) => ["admin", "admins", id] as const,
  roles: ["admin", "roles"] as const,
  permissions: ["admin", "permissions"] as const,
  audit: (query: AuditLogQuery) => ["admin", "audit", query] as const,
  sessions: ["admin", "sessions"] as const,
  settings: (category?: string) =>
    ["admin", "settings", category ?? "all"] as const,
  endUsers: (query: AdminEndUserSearchQuery) =>
    ["admin", "users", query] as const,
  endUser: (id: string) => ["admin", "users", id] as const,
  endUserDevices: (id: string) => ["admin", "users", id, "devices"] as const,
  kycQueue: ["admin", "kyc", "queue"] as const,
  kycSubmission: (userId: string) => ["admin", "kyc", userId] as const,
  transactions: (query: AdminTxnSearchQuery) =>
    ["admin", "transactions", query] as const,
  transaction: (id: string) => ["admin", "transactions", id] as const,
  ledgerHistory: (query: LedgerHistoryQuery) =>
    ["admin", "ledger", query] as const,
  complianceEvents: (query: ComplianceEventQuery) =>
    ["admin", "compliance", "events", query] as const,
  complianceEvent: (id: string) =>
    ["admin", "compliance", "events", id] as const,
  sanctions: ["admin", "compliance", "sanctions"] as const,
  amlRules: ["admin", "compliance", "aml-rules"] as const,
  travelRule: ["admin", "compliance", "travel-rule"] as const,
  complianceReports: ["admin", "compliance", "reports"] as const,
  treasuryBalances: ["admin", "treasury", "balances"] as const,
  treasuryExposure: ["admin", "treasury", "exposure"] as const,
  treasuryAlerts: ["admin", "treasury", "alerts"] as const,
  withdrawalPolicies: ["admin", "treasury", "withdrawal-policies"] as const,
  adminBeneficiaries: (userId?: string) =>
    ["admin", "beneficiaries", userId ?? "all"] as const,
  notificationTemplates: ["admin", "notification-templates"] as const,
  notificationTemplate: (ref: TemplateRef) =>
    [
      "admin",
      "notification-templates",
      ref.templateKey,
      ref.language,
      ref.channel,
    ] as const,
  whatsappConfig: ["admin", "whatsapp", "config"] as const,
  ticketOrders: ["admin", "tickets", "orders"] as const,
  agentConfig: ["admin", "agent", "config"] as const,
  conversations: ["admin", "agent", "conversations"] as const,
  conversation: (id: string) =>
    ["admin", "agent", "conversations", id] as const,
  dashboardMetrics: (range: MetricsRangeQuery) =>
    ["admin", "metrics", "dashboard", range] as const,
} as const
