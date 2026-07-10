/**
 * Typed admin API clients — one function per route. Each parses its input
 * through the request schema before the request fires and parses the response
 * through the response schema after (§3.3 / §8: the FE gate is UX, never the
 * only check; shapes that cross the boundary come from contracts).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */

import {
  AdminLoginRequestSchema,
  AdminLoginResponseSchema,
  AdminMeSchema,
  AdminSelfUpdateRequestSchema,
  AdminStepUpRequestSchema,
  AdminMfaEnrollResponseSchema,
  AdminInvitationCreateRequestSchema,
  AdminInvitationCreateResponseSchema,
  AdminInvitationAcceptRequestSchema,
  AdminInvitationAcceptResponseSchema,
  AdminUserSchema,
  AdminUserListResponseSchema,
  AdminUserUpdateRoleRequestSchema,
  AdminUserStatusRequestSchema,
  RoleSchema,
  RoleListResponseSchema,
  RoleCreateRequestSchema,
  RoleUpdateRequestSchema,
  PermissionListResponseSchema,
  AuditLogQuerySchema,
  AuditLogListResponseSchema,
  AuditChainVerifyResponseSchema,
  AdminSessionListResponseSchema,
  AdminPreferencesSchema,
  AdminPreferencesUpdateRequestSchema,
  AdminMfaResetRequestSchema,
  type AdminPreferences,
  type AdminPreferencesUpdateRequest,
  type AdminSessionListResponse,
  type AdminLoginRequest,
  type AdminLoginResponse,
  type AdminMe,
  type AdminSelfUpdateRequest,
  type AdminStepUpRequest,
  type AdminMfaEnrollResponse,
  type AdminInvitationCreateRequest,
  type AdminInvitationCreateResponse,
  type AdminInvitationAcceptRequest,
  type AdminInvitationAcceptResponse,
  type AdminUser,
  type AdminUserListResponse,
  type AdminUserUpdateRoleRequest,
  type AdminUserStatusRequest,
  type Role,
  type RoleListResponse,
  type RoleCreateRequest,
  type RoleUpdateRequest,
  type PermissionListResponse,
  type AuditLogQuery,
  type AuditLogListResponse,
  type AuditChainVerifyResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(
  input: AdminLoginRequest
): Promise<AdminLoginResponse> {
  const body = AdminLoginRequestSchema.parse(input)
  const res = await api.post("/admin/auth/login", body)
  return AdminLoginResponseSchema.parse(res.data)
}

export async function acceptInvite(
  input: AdminInvitationAcceptRequest
): Promise<AdminInvitationAcceptResponse> {
  const body = AdminInvitationAcceptRequestSchema.parse(input)
  const res = await api.post("/admin/invitations/accept", body)
  return AdminInvitationAcceptResponseSchema.parse(res.data)
}

export async function getMe(): Promise<AdminMe> {
  const res = await api.get("/admin/me")
  return AdminMeSchema.parse(res.data)
}

/**
 * POST /admin/auth/logout — the API clears the HttpOnly `ha_admin_session`
 * cookie. Sends no body; the cookie identifies the session to revoke.
 */
export async function logout(): Promise<void> {
  await api.post("/admin/auth/logout", {})
}

/** Self-serve profile edit (`PATCH /admin/me`) — the operator's own display name.
 *  Returns the refreshed identity so the caller can update the cache in place. */
export async function updateOwnProfile(
  input: AdminSelfUpdateRequest,
): Promise<AdminMe> {
  const body = AdminSelfUpdateRequestSchema.parse(input)
  const res = await api.patch("/admin/me", body)
  return AdminMeSchema.parse(res.data)
}

/** Re-authentication for sensitive actions. 204 No Content on success. */
export async function stepUp(input: AdminStepUpRequest): Promise<void> {
  const body = AdminStepUpRequestSchema.parse(input)
  await api.post("/admin/auth/step-up", body)
}

export async function enrollMfa(): Promise<AdminMfaEnrollResponse> {
  const res = await api.post("/admin/auth/mfa/enroll", {})
  return AdminMfaEnrollResponseSchema.parse(res.data)
}

// ─── Admin users + invitations ──────────────────────────────────────────────────

export async function createInvitation(
  input: AdminInvitationCreateRequest
): Promise<AdminInvitationCreateResponse> {
  const body = AdminInvitationCreateRequestSchema.parse(input)
  const res = await api.post("/admin/invitations", body)
  return AdminInvitationCreateResponseSchema.parse(res.data)
}

export async function listAdmins(): Promise<AdminUserListResponse> {
  const res = await api.get("/admin/admins")
  return AdminUserListResponseSchema.parse(res.data)
}

export async function getAdmin(id: string): Promise<AdminUser> {
  const res = await api.get(`/admin/admins/${id}`)
  return AdminUserSchema.parse(res.data)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function updateAdminRole(
  id: string,
  input: AdminUserUpdateRoleRequest
): Promise<void> {
  const body = AdminUserUpdateRoleRequestSchema.parse(input)
  await api.patch(`/admin/admins/${id}/role`, body)
}

/** Sensitive — may 403 with code ADMIN_STEP_UP_REQUIRED. 204 on success. */
export async function setAdminStatus(
  id: string,
  input: AdminUserStatusRequest
): Promise<void> {
  const body = AdminUserStatusRequestSchema.parse(input)
  await api.patch(`/admin/admins/${id}/status`, body)
}

// ─── Roles + permissions ────────────────────────────────────────────────────────

export async function listRoles(): Promise<RoleListResponse> {
  const res = await api.get("/admin/roles")
  return RoleListResponseSchema.parse(res.data)
}

export async function createRole(input: RoleCreateRequest): Promise<Role> {
  const body = RoleCreateRequestSchema.parse(input)
  const res = await api.post("/admin/roles", body)
  return RoleSchema.parse(res.data)
}

/** Edit a (non-builtin) role's description / permissions. 204 on success. */
export async function updateRole(
  id: string,
  input: RoleUpdateRequest
): Promise<void> {
  const body = RoleUpdateRequestSchema.parse(input)
  await api.patch(`/admin/roles/${id}`, body)
}

export async function listPermissions(): Promise<PermissionListResponse> {
  const res = await api.get("/admin/permissions")
  return PermissionListResponseSchema.parse(res.data)
}

// ─── Audit ──────────────────────────────────────────────────────────────────────

export async function listAudit(
  query: AuditLogQuery
): Promise<AuditLogListResponse> {
  const params = AuditLogQuerySchema.parse(query)
  const res = await api.get("/admin/audit", { params })
  return AuditLogListResponseSchema.parse(res.data)
}

export async function verifyAuditChain(): Promise<AuditChainVerifyResponse> {
  const res = await api.post("/admin/audit/verify", {})
  return AuditChainVerifyResponseSchema.parse(res.data)
}

/**
 * GET /admin/audit/export — a PII-minimised CSV of ALL audit entries matching the
 * current filters (cursor/limit are ignored server-side). Returns the raw Blob for
 * `downloadFile`; the server records an `admin_export` audit event with the rowCount.
 */
export async function exportAuditLog(
  query: AuditLogQuery,
  reason?: string
): Promise<Blob> {
  const res = await api.get<Blob>("/admin/audit/export", {
    params: reason ? { ...query, reason } : query,
    responseType: "blob",
  })
  return res.data
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function listSessions(): Promise<AdminSessionListResponse> {
  const res = await api.get("/admin/sessions")
  return AdminSessionListResponseSchema.parse(res.data)
}

/** Revoke a session by id. 204 on success. */
export async function revokeSession(id: string): Promise<void> {
  await api.delete(`/admin/sessions/${id}`)
}

// ─── Admin MFA reset (for ANOTHER admin) ────────────────────────────────────────

/**
 * POST /admin/admins/:id/mfa/reset — reset another admin's 2FA (they must re-enroll).
 * Sensitive: step-up-gated (may 403 with ADMIN_STEP_UP_REQUIRED) + reason-audited.
 * Reveals no secret; returns nothing on success.
 */
export async function resetAdminMfa(id: string, reason: string): Promise<void> {
  const body = AdminMfaResetRequestSchema.parse({ reason })
  await api.post(`/admin/admins/${id}/mfa/reset`, body)
}

// ─── Self notification preferences (self-scoped; no catalog perm, like /me) ─────

/** GET /admin/me/preferences — the caller's own notification toggles. */
export async function getAdminPreferences(): Promise<AdminPreferences> {
  const res = await api.get("/admin/me/preferences")
  return AdminPreferencesSchema.parse(res.data)
}

/** PATCH /admin/me/preferences — replace the caller's own notification toggles. */
export async function updateAdminPreferences(
  input: AdminPreferencesUpdateRequest
): Promise<AdminPreferences> {
  const body = AdminPreferencesUpdateRequestSchema.parse(input)
  const res = await api.patch("/admin/me/preferences", body)
  return AdminPreferencesSchema.parse(res.data)
}
