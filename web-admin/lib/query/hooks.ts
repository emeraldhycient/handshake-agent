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
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
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
