/**
 * Auth mutation hooks — login, accept-invite, MFA enroll, step-up.
 * Separate from the resource hooks in `hooks.ts` so the auth surface (which
 * touches the admin-auth store) is grouped. Lives in `lib/`; no component
 * imports. Session writes go through the store, not React state.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  AdminInvitationAcceptRequest,
  AdminLoginRequest,
  AdminStepUpRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"
import { qk } from "@/lib/query/keys"

/**
 * Log in. The API Set-Cookies the HttpOnly `ha_admin_session` cookie; on success
 * we keep ONLY the admin identity + expiry in the store (never the token — the
 * cookie authenticates every request) and seed the shared me query so the shell
 * renders without a refetch.
 */
export function useAdminLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AdminLoginRequest) => admin.login(input),
    onSuccess: (data) => {
      queryClient.setQueryData(qk.me, data.admin)
      defaultAdminAuthStore
        .getState()
        .setSession({ admin: data.admin, expiresAt: data.expiresAt })
    },
  })
}

/**
 * Log out. Posts /admin/auth/logout so the API clears the session cookie, then
 * tears down local session state — the store and the cached identity — even if
 * the network call fails, so the operator is signed out client-side regardless.
 * Clearing the store flips `useRequireAuth` to the redirecting phase → /login.
 */
export function useAdminLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => admin.logout(),
    onSettled: () => {
      defaultAdminAuthStore.getState().clear()
      queryClient.removeQueries({ queryKey: qk.me })
    },
  })
}

/** Accept an invitation by setting a password. Does NOT establish a session. */
export function useAcceptInvite() {
  return useMutation({
    mutationFn: (input: AdminInvitationAcceptRequest) =>
      admin.acceptInvite(input),
  })
}

/** Enroll in MFA — returns the otpauth URI, QR SVG, and one-time recovery codes. */
export function useEnrollMfa() {
  return useMutation({
    mutationFn: () => admin.enrollMfa(),
  })
}

/** Re-authenticate (step-up) for a sensitive action. */
export function useStepUp() {
  return useMutation({
    mutationFn: (input: AdminStepUpRequest) => admin.stepUp(input),
  })
}
