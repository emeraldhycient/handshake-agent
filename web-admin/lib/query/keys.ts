/**
 * Query key factory — all TanStack Query keys for the admin app in one place.
 * Each key is a readonly tuple so consumers get stable references and
 * `invalidateQueries` can match precisely by prefix.
 */
import type { AuditLogQuery } from "@handshake-agent/contracts"

export const qk = {
  me: ["admin", "me"] as const,
  admins: ["admin", "admins"] as const,
  admin: (id: string) => ["admin", "admins", id] as const,
  roles: ["admin", "roles"] as const,
  permissions: ["admin", "permissions"] as const,
  audit: (query: AuditLogQuery) => ["admin", "audit", query] as const,
  sessions: ["admin", "sessions"] as const,
} as const
