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
  type AdminEndUserSearchQuery,
  type AdminEndUserListResponse,
  type AdminEndUserDetail,
  type AdminEndUserDevice,
  type AdminEndUserTierRequest,
  type AdminEndUserStatusRequest,
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
