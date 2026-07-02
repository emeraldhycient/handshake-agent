import { z } from "zod";

// Audit-log DTOs — the hash-chained audit entry, the list query (filters +
// cursor + coerced limit), the paginated list response, and the chain-integrity
// verification result. `AuditActionSchema` mirrors the Prisma `AuditAction` enum
// exactly; keep the two in lock-step.

export const AuditActionSchema = z.enum([
  "propose",
  "confirm",
  "authorize",
  "execute",
  "admin_update",
  "admin_review",
  "admin_override",
  "admin_export",
  "sanctions_hit",
  "aml_flag",
  "rule_violation",
  "kyc_state_change",
  "beneficiary_add",
  "beneficiary_remove",
  "device_bind",
  "pin_set",
  "pin_reset",
  "session_create",
  "session_revoke",
  "step_up_challenge",
  "step_up_passed",
  "config_change",
  "audit_chain_check",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditLogEntrySchema = z.object({
  id: z.string().uuid(),
  correlationId: z.string(),
  actor: z.string(),
  actorAdminId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  // The actor's admin role name, resolved from `actorAdminId` at read time. `null`
  // for non-admin actors (system / end user) or when the admin can't be resolved.
  // Derived on read — NOT part of the hash-chained row (§ audit immutability).
  actorRole: z.string().nullable(),
  subject: z.string(),
  action: AuditActionSchema,
  details: z.record(z.unknown()),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  // A first-class human reason for the action, projected from `details.reason`
  // when a non-empty string is present, else `null`. Read-time projection only.
  reason: z.string().nullable(),
  currentHash: z.string(),
  prevHash: z.string(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

export const AuditLogQuerySchema = z.object({
  actorAdminId: z.string().uuid().optional(),
  subject: z.string().optional(),
  action: AuditActionSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;

export const AuditLogListResponseSchema = z.object({
  items: z.array(AuditLogEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;

export const AuditChainVerifyResponseSchema = z.object({
  ok: z.boolean(),
  checked: z.number().int().nonnegative(),
  brokenAt: z.string().nullable(),
});
export type AuditChainVerifyResponse = z.infer<
  typeof AuditChainVerifyResponseSchema
>;
