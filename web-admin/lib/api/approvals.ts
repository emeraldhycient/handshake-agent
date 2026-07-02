/**
 * Typed admin APPROVALS API clients — the maker-checker change-request inbox
 * (Phase 7, WRITES). A first admin (the maker) raises a pending ChangeRequest;
 * a DIFFERENT admin (the checker) approves it — at which point the recorded
 * change is APPLIED atomically + audited by the target service (config writer /
 * engine refund) — or rejects it with a reason. The requester can never
 * self-approve (four-eyes).
 *
 * The inbox read is a projection of pending change requests bucketed relative to
 * the caller. Approve / reject are sensitive dispositions: engine-/config-brokered,
 * audited, idempotent — they never move money from this surface (§3.1) — and may
 * 403 with ADMIN_STEP_UP_REQUIRED; the caller wraps them in `useStepUpRetry`.
 *
 * Each client parses its input through the request schema before the request fires
 * and parses the response through the response schema after (§3.3 / §8: the FE gate
 * is UX, never the only check; shapes that cross the boundary come from contracts).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  ChangeRequestInboxResponseSchema,
  ChangeRequestSchema,
  CreateChangeRequestSchema,
  RejectChangeRequestSchema,
  type ChangeRequestInboxResponse,
  type ChangeRequest,
  type CreateChangeRequest,
  type RejectChangeRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/**
 * GET /admin/approvals/inbox — the two caller-relative buckets (awaiting me /
 * my requests) + their counts. Read-only projection of pending change requests.
 */
export async function getApprovalsInbox(): Promise<ChangeRequestInboxResponse> {
  const res = await api.get("/admin/approvals/inbox")
  return ChangeRequestInboxResponseSchema.parse(res.data)
}

/**
 * POST /admin/approvals — as the maker, raise a pending change request (e.g. a
 * `refund` of a stuck transaction). This APPLIES NOTHING; the recorded change is
 * only executed once a DIFFERENT admin approves it (four-eyes). Sensitive — may
 * 403 with code ADMIN_STEP_UP_REQUIRED. Returns the request in its pending state.
 */
export async function createChange(
  input: CreateChangeRequest
): Promise<ChangeRequest> {
  const body = CreateChangeRequestSchema.parse(input)
  const res = await api.post("/admin/approvals", body)
  return ChangeRequestSchema.parse(res.data)
}

/**
 * POST /admin/approvals/:id/approve — as the checker, approve a pending request;
 * the recorded change is applied by the target service. Sensitive — may 403 with
 * code ADMIN_STEP_UP_REQUIRED. Returns the request in its terminal (approved) state.
 */
export async function approveChange(id: string): Promise<ChangeRequest> {
  const res = await api.post(`/admin/approvals/${id}/approve`, {})
  return ChangeRequestSchema.parse(res.data)
}

/**
 * POST /admin/approvals/:id/reject — refuse a pending request with a required,
 * audited reason. Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. Returns
 * the request in its terminal (rejected) state.
 */
export async function rejectChange(
  id: string,
  input: RejectChangeRequest
): Promise<ChangeRequest> {
  const body = RejectChangeRequestSchema.parse(input)
  const res = await api.post(`/admin/approvals/${id}/reject`, body)
  return ChangeRequestSchema.parse(res.data)
}
