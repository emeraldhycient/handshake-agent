/**
 * Auth mutation hooks — login, accept-invite, MFA enroll, step-up.
 * Separate from the resource hooks in `hooks.ts` so the auth surface (which
 * touches the admin-auth store) is grouped. Lives in `lib/`; no component
 * imports. Session writes go through the store, not React state.
 */
import { useMutation } from "@tanstack/react-query"
import type {
  AdminInvitationAcceptRequest,
  AdminLoginRequest,
  AdminStepUpRequest,
} from "@handshake-agent/contracts"

import * as admin from "@/lib/api/admin"
import { defaultAdminAuthStore } from "@/lib/store/admin-auth-store"

/**
 * Log in. On success, persists the session (token + admin identity) to the
 * admin-auth store — the interceptor then attaches the token to every request.
 */
export function useAdminLogin() {
  return useMutation({
    mutationFn: (input: AdminLoginRequest) => admin.login(input),
    onSuccess: (data) => {
      defaultAdminAuthStore
        .getState()
        .setSession({ accessToken: data.accessToken, admin: data.admin })
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
