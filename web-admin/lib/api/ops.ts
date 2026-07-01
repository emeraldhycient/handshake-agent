/**
 * Typed admin-ops API client (Phase 6b) — the READ-ONLY "System / ops" board:
 * per-provider status, webhook-ingest queue depths + retries, and the
 * background-jobs / cron registry. Parses the response through the contract schema
 * after the request (§3.3 / §8: the FE gate is UX, never the only check; shapes that
 * cross the boundary come from contracts). Nothing here moves money (§3.1) — it is a
 * point-in-time projection only.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminOpsRunRequestSchema,
  AdminOpsRunResponseSchema,
  OpsBoardSchema,
  type AdminOpsRunRequest,
  type AdminOpsRunResponse,
  type OpsBoard,
} from "@handshake-agent/contracts"

import { api } from "./client"

/**
 * GET /admin/ops — the composite "System / ops" board: the provider status board,
 * the webhook-ingest queues (depth + retries), and the background-jobs / cron
 * registry (schedule + last observed run + status).
 */
export async function getOpsBoard(): Promise<OpsBoard> {
  const res = await api.get("/admin/ops")
  return OpsBoardSchema.parse(res.data)
}

/**
 * POST /admin/ops/jobs/:id/run — trigger a manual run of a declared background job
 * (Phase 7, WRITE). Engine-brokered oversight — re-drives an existing worker; moves
 * no money (§3.1). Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED (the caller wraps
 * in `useStepUpRetry`). Parses the body before the request and the response after.
 */
export async function runOpsJob(
  id: string,
  input: AdminOpsRunRequest
): Promise<AdminOpsRunResponse> {
  const body = AdminOpsRunRequestSchema.parse(input)
  const res = await api.post(`/admin/ops/jobs/${id}/run`, body)
  return AdminOpsRunResponseSchema.parse(res.data)
}
