import { z } from "zod";

import { AuditLogQuerySchema } from "./audit.dto";
import { AdminLedgerListQuerySchema } from "./admin-ledger.dto";
import { AdminEndUserSearchQuerySchema } from "./user-mgmt.dto";

// Admin CSV-export QUERY DTOs (Phase 8) — READ-ONLY. A CSV export covers ALL
// rows matching the current list filters (not just the visible page), so each
// export query is the corresponding LIST query with the paging fields
// (`cursor` / `limit`) stripped — DRY: the filter shapes are reused from the
// list DTOs, never re-declared. Every export additionally carries an optional
// audited `reason` (the export writes an `admin_export` audit event with the
// resulting rowCount). Exports are PII-minimised (last-4 only) server-side.

// ── End-users export ─────────────────────────────────────────────────────────
// The end-user search filters minus paging, PLUS an optional `includedIds`
// allow-list (export only these selected users when the operator has hand-picked
// rows) and an optional audited `reason`.
export const AdminEndUsersExportQuerySchema = AdminEndUserSearchQuerySchema.omit(
  { cursor: true, limit: true },
).extend({
  includedIds: z.array(z.string().uuid()).optional(),
  reason: z.string().max(500).optional(),
});
export type AdminEndUsersExportQuery = z.infer<
  typeof AdminEndUsersExportQuerySchema
>;

// ── Ledger export ────────────────────────────────────────────────────────────
// The global ledger-browse filters minus paging, plus an optional audited reason.
export const AdminLedgerExportQuerySchema = AdminLedgerListQuerySchema.omit({
  cursor: true,
  limit: true,
}).extend({
  reason: z.string().max(500).optional(),
});
export type AdminLedgerExportQuery = z.infer<
  typeof AdminLedgerExportQuerySchema
>;

// ── Audit-log export ─────────────────────────────────────────────────────────
// The audit-log filters minus paging, plus an optional audited reason.
export const AuditLogExportQuerySchema = AuditLogQuerySchema.omit({
  cursor: true,
  limit: true,
}).extend({
  reason: z.string().max(500).optional(),
});
export type AuditLogExportQuery = z.infer<typeof AuditLogExportQuerySchema>;
