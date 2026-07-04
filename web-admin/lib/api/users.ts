/**
 * Typed admin end-user API clients — one function per route. Each parses its
 * input through the request schema before the request fires and parses the
 * response through the response schema after (§3.3 / §8: the FE gate is UX,
 * never the only check; shapes that cross the boundary come from contracts).
 *
 * These are the platform's END USERS (not admin console accounts — those live
 * in `admin.ts`). The sensitive mutations (tier / status / pin-reset / device
 * revoke / sim-swap) may 403 with code ADMIN_STEP_UP_REQUIRED; callers wrap
 * them in `useStepUpRetry` to re-auth and replay.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminEndUserSearchQuerySchema,
  AdminEndUserListResponseSchema,
  AdminEndUserDetailSchema,
  AdminEndUserDeviceSchema,
  AdminEndUserTierRequestSchema,
  AdminEndUserStatusRequestSchema,
  AdminEndUserSessionListResponseSchema,
  AdminEndUserLimitsResponseSchema,
  AdminEndUserTimelineResponseSchema,
  ApplyUserTagsRequestSchema,
  ApplyUserTagsResponseSchema,
  BulkMessageRequestSchema,
  BulkMessageResponseSchema,
  CreateManualCreditRequestSchema,
  ChangeRequestSchema,
  AdminUserNoteCreateRequestSchema,
  AdminUserNoteSchema,
  AdminUserNoteListResponseSchema,
  ResendVerificationRequestSchema,
  ForceReKycRequestSchema,
  AdminUserSessionRevokeRequestSchema,
  type AdminUserNoteCreateRequest,
  type AdminUserNote,
  type AdminUserNoteListResponse,
  type AdminEndUserSearchQuery,
  type AdminEndUserListResponse,
  type AdminEndUserDetail,
  type AdminEndUserDevice,
  type AdminEndUserSession,
  type AdminEndUserLimitsResponse,
  type AdminEndUserTimelineEntry,
  type AdminEndUserTierRequest,
  type AdminEndUserStatusRequest,
  type ApplyUserTagsRequest,
  type ApplyUserTagsResponse,
  type BulkMessageRequest,
  type BulkMessageResponse,
  type CreateManualCreditRequest,
  type ChangeRequest,
} from "@handshake-agent/contracts"
import { z } from "zod"

import { api } from "./client"

const DeviceListSchema = z.array(AdminEndUserDeviceSchema)

/** GET /admin/users — search / filter / paginate the platform's end users. */
export async function listEndUsers(
  query: AdminEndUserSearchQuery
): Promise<AdminEndUserListResponse> {
  const params = AdminEndUserSearchQuerySchema.parse(query)
  const res = await api.get("/admin/users", { params })
  return AdminEndUserListResponseSchema.parse(res.data)
}

/**
 * GET /admin/users/export — a PII-minimised CSV of ALL end users matching the
 * current filters (last-4 NIN/BVN only, §3.4; cursor/limit ignored server-side).
 * `includedIds` scopes it to a selection (bulk-bar export). Returns the raw Blob for
 * `downloadFile`; the server records an `admin_export` audit event with the rowCount.
 */
export async function exportEndUsers(
  query: AdminEndUserSearchQuery,
  includedIds?: string[],
  reason?: string
): Promise<Blob> {
  const res = await api.get<Blob>("/admin/users/export", {
    params: {
      ...query,
      ...(includedIds && includedIds.length > 0 ? { includedIds } : {}),
      ...(reason ? { reason } : {}),
    },
    responseType: "blob",
  })
  return res.data
}

/** GET /admin/users/:id — the full end-user aggregate (identity + devices + balances + history). */
export async function getEndUser(id: string): Promise<AdminEndUserDetail> {
  const res = await api.get(`/admin/users/${id}`)
  return AdminEndUserDetailSchema.parse(res.data)
}

/** GET /admin/users/:id/devices — the user's bound/revoked devices. */
export async function listEndUserDevices(
  id: string
): Promise<AdminEndUserDevice[]> {
  const res = await api.get(`/admin/users/${id}/devices`)
  return DeviceListSchema.parse(res.data)
}

/** GET /admin/users/:id/sessions — the user's active + recent auth sessions (Security tab). */
export async function listEndUserSessions(
  id: string
): Promise<AdminEndUserSession[]> {
  const res = await api.get(`/admin/users/${id}/sessions`)
  return AdminEndUserSessionListResponseSchema.parse(res.data).sessions
}

/** GET /admin/users/:id/limits — effective per-tier caps + live velocity usage (Limits tab). */
export async function getEndUserLimits(
  id: string
): Promise<AdminEndUserLimitsResponse> {
  const res = await api.get(`/admin/users/${id}/limits`)
  return AdminEndUserLimitsResponseSchema.parse(res.data)
}

/** GET /admin/users/:id/timeline — the admin-action timeline from the audit log (Profile tab). */
export async function listEndUserTimeline(
  id: string
): Promise<AdminEndUserTimelineEntry[]> {
  const res = await api.get(`/admin/users/${id}/timeline`)
  return AdminEndUserTimelineResponseSchema.parse(res.data).entries
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function adjustTier(
  id: string,
  input: AdminEndUserTierRequest
): Promise<void> {
  const body = AdminEndUserTierRequestSchema.parse(input)
  await api.patch(`/admin/users/${id}/tier`, body)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function setEndUserStatus(
  id: string,
  input: AdminEndUserStatusRequest
): Promise<void> {
  const body = AdminEndUserStatusRequestSchema.parse(input)
  await api.patch(`/admin/users/${id}/status`, body)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function forcePinReset(id: string): Promise<void> {
  await api.post(`/admin/users/${id}/pin-reset`, {})
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function revokeDevice(
  id: string,
  deviceId: string
): Promise<void> {
  await api.delete(`/admin/users/${id}/devices/${deviceId}`)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function simSwapReverify(id: string): Promise<void> {
  await api.post(`/admin/users/${id}/sim-swap-reverify`, {})
}

/**
 * Raise a MANUAL-CREDIT request for a user's wallet (POST /admin/users/:id/credit).
 * MAKER action only: it moves NO money — it records a pending `manual_credit`
 * ChangeRequest a SECOND admin must approve (four-eyes, §3.1). The engine-brokered
 * credit runs on approval via the approvals inbox. Body parsed before send, the
 * created ChangeRequest parsed after. Returns the created request (201).
 */
export async function requestManualCredit(
  id: string,
  input: CreateManualCreditRequest
): Promise<ChangeRequest> {
  const body = CreateManualCreditRequestSchema.parse(input)
  const res = await api.post(`/admin/users/${id}/credit`, body)
  return ChangeRequestSchema.parse(res.data)
}

/**
 * POST /admin/users/tags — bulk-apply an operator TAG to the selected users. A tag
 * is a pure annotation — it moves no money and confers no authorization (§3.1).
 * Idempotent (re-tagging is a no-op). Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function applyUserTags(
  input: ApplyUserTagsRequest
): Promise<ApplyUserTagsResponse> {
  const body = ApplyUserTagsRequestSchema.parse(input)
  const res = await api.post("/admin/users/tags", body)
  return ApplyUserTagsResponseSchema.parse(res.data)
}

/**
 * POST /admin/users/message — bulk-queue a templated broadcast to the selected
 * users. The body references an admin-authored template (the model never authors
 * it) and enqueues onto the notifications outbox — never a direct send (§3.1).
 * A large selection additionally requires `confirmLargeSet` (re-checked server-side,
 * §3.3) — a 422 ADMIN_BULK_CONFIRMATION_REQUIRED asks the operator to confirm.
 * Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function sendBulkMessage(
  input: BulkMessageRequest
): Promise<BulkMessageResponse> {
  const body = BulkMessageRequestSchema.parse(input)
  const res = await api.post("/admin/users/message", body)
  return BulkMessageResponseSchema.parse(res.data)
}

// ─── Phase 9 — case notes / verification / re-KYC / session revocation ────────────
// None moves money (§3.4/§3.1). Each parses its input before the request fires and
// its response after (§8). The mutating routes are immutably audited server-side.

/** GET /admin/users/:id/notes — the user's immutable case notes (newest-first). */
export async function listUserNotes(
  id: string
): Promise<AdminUserNoteListResponse> {
  const res = await api.get(`/admin/users/${id}/notes`)
  return AdminUserNoteListResponseSchema.parse(res.data)
}

/**
 * POST /admin/users/:id/notes — append an immutable case note. Body parsed before
 * send, the created note parsed after. Returns the created note (201).
 */
export async function createUserNote(
  id: string,
  input: AdminUserNoteCreateRequest
): Promise<AdminUserNote> {
  const body = AdminUserNoteCreateRequestSchema.parse(input)
  const res = await api.post(`/admin/users/${id}/notes`, body)
  return AdminUserNoteSchema.parse(res.data)
}

/**
 * POST /admin/users/:id/resend-verification — re-send the user's verification
 * email/link. The reason is OPTIONAL (a resend is low-risk); when omitted an
 * empty body is sent. Body parsed before the request fires. 204 on success.
 */
export async function resendVerification(
  id: string,
  reason?: string
): Promise<void> {
  const body = ResendVerificationRequestSchema.parse(reason ? { reason } : {})
  await api.post(`/admin/users/${id}/resend-verification`, body)
}

/**
 * POST /admin/users/:id/force-rekyc — force the user back through KYC (e.g. after
 * a SIM-swap / identity concern). The required reason is the audited justification.
 * Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED. 204 on success.
 */
export async function forceReKyc(id: string, reason: string): Promise<void> {
  const body = ForceReKycRequestSchema.parse({ reason })
  await api.post(`/admin/users/${id}/force-rekyc`, body)
}

/**
 * DELETE /admin/users/:id/sessions/:sessionId — revoke ONE of the user's auth
 * sessions. The required reason rides on the request `data` body (DELETE) and is
 * parsed before the request fires. Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function revokeUserSession(
  id: string,
  sessionId: string,
  reason: string
): Promise<void> {
  const data = AdminUserSessionRevokeRequestSchema.parse({ reason })
  await api.delete(`/admin/users/${id}/sessions/${sessionId}`, { data })
}

/**
 * DELETE /admin/users/:id/sessions — revoke ALL of the user's auth sessions (force
 * sign-out). The required reason rides on the request `data` body (DELETE) and is
 * parsed before the request fires. Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED.
 */
export async function revokeAllUserSessions(
  id: string,
  reason: string
): Promise<void> {
  const data = AdminUserSessionRevokeRequestSchema.parse({ reason })
  await api.delete(`/admin/users/${id}/sessions`, { data })
}
