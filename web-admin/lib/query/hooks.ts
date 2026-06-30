/**
 * TanStack Query hooks — the admin data layer.
 *
 * All hooks call the typed clients in `lib/api/admin.ts` and use the `qk` key
 * factory. This file lives in `lib/` and must NOT import from `components/` or
 * `app/`. Mutations invalidate the queries they affect.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminEndUserSearchQuery,
  AdminEndUserStatusRequest,
  AdminEndUserTierRequest,
  AdminInvitationCreateRequest,
  AdminUserStatusRequest,
  AdminUserUpdateRoleRequest,
  AuditLogQuery,
  KycApproveRequest,
  KycRejectRequest,
  RoleCreateRequest,
  RoleUpdateRequest,
  UpdateSettingRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import * as kyc from "@/lib/api/kyc"
import * as settings from "@/lib/api/settings"
import * as users from "@/lib/api/users"
import { qk } from "./keys"

// ─── Read hooks ─────────────────────────────────────────────────────────────────

/**
 * The signed-in admin's resolved identity + effective RBAC grants. Drives nav
 * and page gating. Short staleTime — grants can change under the operator.
 */
export function useAdminMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => admin.getMe(),
    staleTime: 60_000,
    retry: false,
  })
}

/** All admin users. Refreshed on focus; 30 s stale. */
export function useAdmins() {
  return useQuery({
    queryKey: qk.admins,
    queryFn: () => admin.listAdmins(),
    staleTime: 30_000,
  })
}

/** All roles (built-in + custom). 5 min stale — roles change rarely. */
export function useRoles() {
  return useQuery({
    queryKey: qk.roles,
    queryFn: () => admin.listRoles(),
    staleTime: 5 * 60_000,
  })
}

/** The permission catalog. Effectively static for a deploy — long staleTime. */
export function usePermissions() {
  return useQuery({
    queryKey: qk.permissions,
    queryFn: () => admin.listPermissions(),
    staleTime: 30 * 60_000,
  })
}

/** Filtered, paginated audit log. Keyed by the query so filters re-fetch. */
export function useAudit(query: AuditLogQuery) {
  return useQuery({
    queryKey: qk.audit(query),
    queryFn: () => admin.listAudit(query),
    staleTime: 15_000,
  })
}

/** The current admin's sessions. 15 s stale. */
export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => admin.listSessions(),
    staleTime: 15_000,
  })
}

/**
 * Effective config settings for one category (or all). Keyed by category so each
 * tab caches independently. 30 s stale — DB overrides are hot-reloaded server-side.
 */
export function useSettings(category?: string) {
  return useQuery({
    queryKey: qk.settings(category),
    queryFn: () => settings.listSettings(category),
    staleTime: 30_000,
  })
}

/** Search / filter / paginate the platform's end users. Keyed by the query. */
export function useEndUsers(query: AdminEndUserSearchQuery) {
  return useQuery({
    queryKey: qk.endUsers(query),
    queryFn: () => users.listEndUsers(query),
    staleTime: 15_000,
  })
}

/** One end user's full aggregate (identity + devices + balances + history). */
export function useEndUserDetail(id: string | null) {
  return useQuery({
    queryKey: qk.endUser(id ?? ""),
    queryFn: () => users.getEndUser(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The end user's bound/revoked devices. */
export function useEndUserDevices(id: string | null) {
  return useQuery({
    queryKey: qk.endUserDevices(id ?? ""),
    queryFn: () => users.listEndUserDevices(id as string),
    enabled: id !== null,
    staleTime: 15_000,
  })
}

/** The KYC review queue. 15 s stale. */
export function useKycQueue() {
  return useQuery({
    queryKey: qk.kycQueue,
    queryFn: () => kyc.listKycQueue(),
    staleTime: 15_000,
  })
}

/** One KYC submission's reviewable detail (last-4 PII only). */
export function useKycSubmission(userId: string | null) {
  return useQuery({
    queryKey: qk.kycSubmission(userId ?? ""),
    queryFn: () => kyc.getKycSubmission(userId as string),
    enabled: userId !== null,
    staleTime: 15_000,
  })
}

// ─── Mutation hooks ─────────────────────────────────────────────────────────────

export function useCreateInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AdminInvitationCreateRequest) =>
      admin.createInvitation(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useUpdateAdminRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminUserUpdateRoleRequest
    }) => admin.updateAdminRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useSetAdminStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminUserStatusRequest
    }) => admin.setAdminStatus(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.admins })
    },
  })
}

export function useCreateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RoleCreateRequest) => admin.createRole(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.roles })
    },
  })
}

export function useUpdateRole() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RoleUpdateRequest }) =>
      admin.updateRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.roles })
    },
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => admin.revokeSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.sessions })
    },
  })
}

export function useVerifyAuditChain() {
  return useMutation({
    mutationFn: () => admin.verifyAuditChain(),
  })
}

/**
 * Update one config setting. On success invalidates every settings query (the
 * prefix match) so all category tabs re-resolve — a catalog flip can change a
 * sibling's effective state. The PATCH may 403 with ADMIN_STEP_UP_REQUIRED; the
 * caller wraps the mutation in `useStepUpRetry` to re-auth and retry.
 */
export function useUpdateSetting() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      key,
      input,
    }: {
      key: string
      input: UpdateSettingRequest
    }) => settings.updateSetting(key, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "settings"] })
    },
  })
}

// ─── End-user mutations ───────────────────────────────────────────────────────────
// Each is sensitive (may 403 with ADMIN_STEP_UP_REQUIRED — the caller wraps it in
// `useStepUpRetry`). On success they invalidate the user's queries so the detail
// + list re-resolve. `["admin", "users"]` is a prefix match covering the list,
// detail, and devices keys.

export function useAdjustTier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminEndUserTierRequest
    }) => users.adjustTier(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useSetUserStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: AdminEndUserStatusRequest
    }) => users.setEndUserStatus(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useForcePinReset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => users.forcePinReset(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useRevokeDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deviceId }: { id: string; deviceId: string }) =>
      users.revokeDevice(id, deviceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

export function useSimSwapReverify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => users.simSwapReverify(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
  })
}

// ─── KYC-review mutations ─────────────────────────────────────────────────────────
// Sensitive (may 403 with ADMIN_STEP_UP_REQUIRED). On success they invalidate the
// queue and the reviewed submission so both re-resolve.

export function useApproveKyc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string
      input: KycApproveRequest
    }) => kyc.approveKyc(userId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
    },
  })
}

export function useRejectKyc() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      userId,
      input,
    }: {
      userId: string
      input: KycRejectRequest
    }) => kyc.rejectKyc(userId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "kyc"] })
    },
  })
}
