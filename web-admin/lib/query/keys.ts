/**
 * Query key factory — all TanStack Query keys for the admin app in one place.
 * Each key is a readonly tuple so consumers get stable references and
 * `invalidateQueries` can match precisely by prefix.
 */
import type {
  AdminEndUserSearchQuery,
  AuditLogQuery,
} from "@handshake-agent/contracts"

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
} as const
