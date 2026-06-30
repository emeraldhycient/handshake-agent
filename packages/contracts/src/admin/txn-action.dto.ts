import { z } from "zod";

// Admin transaction TRIAGE action DTOs (Phase 3, sub-area B) — the engine-brokered,
// audited, idempotent admin remediation of stuck transactions. Unlike the read-only
// oversight DTOs (`admin-txn.dto.ts`), these requests trigger a state change, but the
// mutation NEVER moves money directly: a mark-failed routes through the deterministic
// engine's atomic refund methods, and a retry only re-enqueues the settlement outbox
// row for the existing reconciliation worker (§3.1). Single source of truth shared by
// the API (request validation + response parsing) and web-admin.

// ── Request: mark a stuck transaction failed (and refund its reserve) ────────────
// `reason` is the operator's note, recorded in the audit trail and the
// CompensationRecord. Non-empty so the audit log always carries a justification.
export const AdminTxnMarkFailedRequestSchema = z.object({
  reason: z.string().min(1),
});
export type AdminTxnMarkFailedRequest = z.infer<
  typeof AdminTxnMarkFailedRequestSchema
>;

// ── Response: the outcome of a triage action (mark-failed OR retry) ──────────────
// `refunded` is true when a reserve was reversed (mark-failed of a sell/send/swap),
// false for a retry (which re-enqueues settlement, moving no money itself). `status`
// is the transaction's status after the action (e.g. 'failed' for mark-failed, or the
// unchanged status for a retry).
export const AdminTxnActionResponseSchema = z.object({
  transactionId: z.string(),
  status: z.string(),
  refunded: z.boolean(),
});
export type AdminTxnActionResponse = z.infer<
  typeof AdminTxnActionResponseSchema
>;
