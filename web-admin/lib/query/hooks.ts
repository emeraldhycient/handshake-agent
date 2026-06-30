/**
 * TanStack Query hooks — the admin data layer.
 *
 * All hooks call the typed clients in `lib/api/admin.ts` and use the `qk` key
 * factory. This file lives in `lib/` and must NOT import from `components/` or
 * `app/`. Mutations invalidate the queries they affect.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminInvitationCreateRequest,
  AdminUserStatusRequest,
  AdminUserUpdateRoleRequest,
  AuditLogQuery,
  RoleCreateRequest,
  RoleUpdateRequest,
  UpdateSettingRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import * as settings from "@/lib/api/settings"
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
