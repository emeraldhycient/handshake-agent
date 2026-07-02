/**
 * Typed KYC-review API clients — the compliance reviewer's surface. Each parses
 * its input through the request schema before the request fires and parses the
 * response through the response schema after (§3.3 / §8: the FE gate is UX,
 * never the only check; shapes that cross the boundary come from contracts).
 *
 * PII is minimized at the API: only the last 4 digits of NIN/BVN are surfaced.
 * Approve / reject are sensitive and may 403 with ADMIN_STEP_UP_REQUIRED; the
 * caller wraps them in `useStepUpRetry`.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  KycQueueQuerySchema,
  KycQueueResponseSchema,
  KycSubmissionDetailSchema,
  KycApproveRequestSchema,
  KycRejectRequestSchema,
  type KycQueueQuery,
  type KycQueueResponse,
  type KycSubmissionDetail,
  type KycApproveRequest,
  type KycRejectRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/**
 * GET /admin/kyc/queue — submissions in a KYC-status bucket. `status` feeds the
 * console's status tabs (defaults to pending_review server-side when omitted).
 * The query is parsed before it fires (§3.3 / §8).
 */
export async function listKycQueue(
  query: KycQueueQuery = {}
): Promise<KycQueueResponse> {
  const params = KycQueueQuerySchema.parse(query)
  const res = await api.get("/admin/kyc/queue", { params })
  return KycQueueResponseSchema.parse(res.data)
}

/** GET /admin/kyc/:userId — one submission's reviewable detail (last-4 PII only). */
export async function getKycSubmission(
  userId: string
): Promise<KycSubmissionDetail> {
  const res = await api.get(`/admin/kyc/${userId}`)
  return KycSubmissionDetailSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function approveKyc(
  userId: string,
  input: KycApproveRequest
): Promise<void> {
  const body = KycApproveRequestSchema.parse(input)
  await api.post(`/admin/kyc/${userId}/approve`, body)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function rejectKyc(
  userId: string,
  input: KycRejectRequest
): Promise<void> {
  const body = KycRejectRequestSchema.parse(input)
  await api.post(`/admin/kyc/${userId}/reject`, body)
}
