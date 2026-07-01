import { z } from "zod";

// Admin OPS-ACTION DTOs (Phase 7, WRITE) — the "Run now" trigger for a declared
// background job on the System/ops board. This is engine-brokered OVERSIGHT, not a
// money movement: running a job re-drives an EXISTING deterministic worker (e.g. the
// settlement-reconciliation tick) — it NEVER constructs a ledger entry or settles
// inline itself (§3.1). The request carries the operator's audited reason; the
// response reports whether the run was actually triggered + the job's post-trigger
// status. Single source of truth shared by the API (request + response parsing) and
// web-admin. No PII crosses this boundary — system-job identifiers only (§3.4).

// ── Request: trigger a manual run of a declared job ──────────────────────────────
// `reason` is the operator's justification, recorded in the immutable audit trail.
// Non-empty so every manual run carries a why.
export const AdminOpsRunRequestSchema = z.object({
  reason: z.string().min(1),
});
export type AdminOpsRunRequest = z.infer<typeof AdminOpsRunRequestSchema>;

// ── Response: the outcome of a manual run trigger ────────────────────────────────
// `jobId` echoes the job that was triggered; `triggered` is true when the worker's
// run method was invoked (an idle/registered-but-not-manually-triggerable job that
// the platform does not expose for out-of-band runs yields `triggered: false`).
// `status` is the job's declared post-trigger status word (e.g. "running"). No money
// moves — there is no `refunded`/ledger field by construction (§3.1).
export const AdminOpsRunResponseSchema = z.object({
  jobId: z.string(),
  triggered: z.boolean(),
  status: z.string(),
});
export type AdminOpsRunResponse = z.infer<typeof AdminOpsRunResponseSchema>;
