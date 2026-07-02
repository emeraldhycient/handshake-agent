/**
 * Typed admin transactions API clients — the deterministic-engine oversight +
 * triage surface (Phase 3, sub-areas A/B). Each parses its input through the
 * request schema before the request fires and parses the response through the
 * response schema after (§3.3 / §8: the FE gate is UX, never the only check;
 * shapes that cross the boundary come from contracts).
 *
 * The list/detail reads are read-only projections of the Transaction + ledger.
 * Mark-failed / retry are sensitive triage actions (engine-brokered, audited,
 * idempotent — they never move money directly) and may 403 with
 * ADMIN_STEP_UP_REQUIRED; the caller wraps them in `useStepUpRetry`.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminTxnSearchQuerySchema,
  AdminTxnListResponseSchema,
  AdminTxnDetailSchema,
  AdminTxnMarkFailedRequestSchema,
  AdminTxnActionResponseSchema,
  TxnRerunReconRequestSchema,
  ReconBreakListResponseSchema,
  type AdminTxnSearchQuery,
  type AdminTxnListResponse,
  type AdminTxnDetail,
  type AdminTxnMarkFailedRequest,
  type AdminTxnActionResponse,
  type ReconBreakListResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/transactions — search / filter / paginate the engine's transactions. */
export async function listTransactions(
  query: AdminTxnSearchQuery
): Promise<AdminTxnListResponse> {
  const params = AdminTxnSearchQuerySchema.parse(query)
  const res = await api.get("/admin/transactions", { params })
  return AdminTxnListResponseSchema.parse(res.data)
}

/** GET /admin/transactions/:id — one transaction's detail (ledger legs + timeline). */
export async function getTransaction(id: string): Promise<AdminTxnDetail> {
  const res = await api.get(`/admin/transactions/${id}`)
  return AdminTxnDetailSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the action outcome. */
export async function markTransactionFailed(
  id: string,
  input: AdminTxnMarkFailedRequest
): Promise<AdminTxnActionResponse> {
  const body = AdminTxnMarkFailedRequestSchema.parse(input)
  const res = await api.post(`/admin/transactions/${id}/mark-failed`, body)
  return AdminTxnActionResponseSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns the action outcome. */
export async function retryTransaction(
  id: string
): Promise<AdminTxnActionResponse> {
  const res = await api.post(`/admin/transactions/${id}/retry`, {})
  return AdminTxnActionResponseSchema.parse(res.data)
}

/**
 * POST /admin/transactions/:id/reconcile — re-run reconciliation for ONE transaction
 * (Phase 8). READ-ONLY provider-vs-ledger detection (distinct from retry, which
 * re-drives settlement); moves no money (§3.1). Returns any detected breaks.
 */
export async function rerunReconciliation(
  id: string,
  reason?: string
): Promise<ReconBreakListResponse> {
  const body = TxnRerunReconRequestSchema.parse(reason ? { reason } : {})
  const res = await api.post(`/admin/transactions/${id}/reconcile`, body)
  return ReconBreakListResponseSchema.parse(res.data)
}
