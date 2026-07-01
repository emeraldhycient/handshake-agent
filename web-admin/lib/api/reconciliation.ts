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
  ReconBreakListResponseSchema,
  ReconStatusSchema,
  type ReconBreakListResponse,
  type ReconStatus,
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
