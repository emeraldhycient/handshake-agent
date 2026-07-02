/**
 * Typed admin reconciliation API clients (Phase 6b, READ-ONLY) — the provider-vs-
 * ledger break list + the reconciliation-cron status bar. Each parses its response
 * through the response schema after the request (§3.3 / §8: the FE gate is UX, never
 * the only check; shapes that cross the boundary come from contracts).
 *
 * Nothing here moves money (§3.1) — these are read projections. Over-credits are
 * surfaced for human action, never auto-debited; the resolve/accept/escalate/run-now
 * WRITES are Phase 7.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  ReconAcceptRequestSchema,
  ReconActionResponseSchema,
  ReconBreakListResponseSchema,
  ReconResolveRequestSchema,
  ReconStatusSchema,
  EscalateBreakRequestSchema,
  ComplianceEventItemSchema,
  type ReconAcceptRequest,
  type ReconActionResponse,
  type ReconBreakListResponse,
  type ReconResolveRequest,
  type ReconStatus,
  type ComplianceEventItem,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/reconciliation/breaks — provider-vs-ledger breaks, newest-first. */
export async function listReconBreaks(): Promise<ReconBreakListResponse> {
  const res = await api.get("/admin/reconciliation/breaks")
  return ReconBreakListResponseSchema.parse(res.data)
}

/** GET /admin/reconciliation/status — cron status (last/next run, open-break count). */
export async function getReconStatus(): Promise<ReconStatus> {
  const res = await api.get("/admin/reconciliation/status")
  return ReconStatusSchema.parse(res.data)
}

/**
 * POST /admin/reconciliation/breaks/:id/resolve — resolve a break via the engine
 * (Phase 7, WRITE). Engine-brokered: re-drives the offending txn's settlement — never
 * a raw debit (§3.1). Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED. Parses the
 * body before the request and the response after.
 */
export async function resolveReconBreak(
  id: string,
  input: ReconResolveRequest
): Promise<ReconActionResponse> {
  const body = ReconResolveRequestSchema.parse(input)
  const res = await api.post(`/admin/reconciliation/breaks/${id}/resolve`, body)
  return ReconActionResponseSchema.parse(res.data)
}

/**
 * POST /admin/reconciliation/breaks/:id/accept — accept a break as-is (Phase 7,
 * WRITE). Dual-control, no-debit disposition; moves no money (§3.1). Sensitive — may
 * 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function acceptReconBreak(
  id: string,
  input: ReconAcceptRequest
): Promise<ReconActionResponse> {
  const body = ReconAcceptRequestSchema.parse(input)
  const res = await api.post(`/admin/reconciliation/breaks/${id}/accept`, body)
  return ReconActionResponseSchema.parse(res.data)
}

/**
 * POST /admin/reconciliation/breaks/:id/escalate — escalate a break into a
 * compliance case (Phase 8, WRITE). Opens a ComplianceEvent from the break; moves
 * no money (§3.1). Sensitive — step-up-gated (may 403 with ADMIN_STEP_UP_REQUIRED).
 */
export async function escalateReconBreak(
  id: string,
  reason: string
): Promise<ComplianceEventItem> {
  const body = EscalateBreakRequestSchema.parse({ reason })
  const res = await api.post(
    `/admin/reconciliation/breaks/${id}/escalate`,
    body
  )
  return ComplianceEventItemSchema.parse(res.data)
}
