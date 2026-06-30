/**
 * TanStack Query hooks for auth operations.
 *
 * Four mutations (signup, verify-email, login-request, login-verify) and one
 * query (me). Mirrors the kyc.ts pattern: components never import the API
 * client directly — they go through these hooks.
 *
 * useLoginVerify stores the session in the Zustand auth store on success so
 * the Axios Bearer interceptor picks it up immediately.
 *
 * useMe is enabled only when there is an in-memory access token (i.e. the user
 * has authenticated in this session or the interceptor has already performed a
 * silent refresh).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  LoginRequest,
  LoginVerifyRequest,
  SignupRequest,
  VerifyEmailRequest,
} from "@handshake-agent/contracts/auth"
import {
  fetchMe,
  fetchProfile,
  logout,
  submitLoginRequest,
  submitLoginVerify,
  submitSignup,
  submitVerifyEmail,
} from "@/lib/api/auth"
import { defaultAuthStore, useAuthStore } from "@/lib/store/auth-store"
import { qk } from "./keys"

export function useSignup() {
  return useMutation({
    mutationFn: (body: SignupRequest) => submitSignup(body),
  })
}

export function useVerifyEmail() {
  return useMutation({
    mutationFn: (body: VerifyEmailRequest) => submitVerifyEmail(body),
  })
}

export function useLoginRequest() {
  return useMutation({
    mutationFn: (body: LoginRequest) => submitLoginRequest(body),
  })
}

export function useLoginVerify() {
  return useMutation({
    mutationFn: (body: LoginVerifyRequest) => submitLoginVerify(body),
    onSuccess: (data) => {
      defaultAuthStore.getState().setSession(data)
    },
  })
}

export function useMe() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: qk.me,
    queryFn: fetchMe,
    enabled: !!accessToken,
  })
}

/** Settings profile (email, name, phone, KYC tier + limits). Cached 60 s. */
export function useProfile() {
  const accessToken = useAuthStore((s) => s.accessToken)
  return useQuery({
    queryKey: qk.profile,
    queryFn: fetchProfile,
    enabled: !!accessToken,
    staleTime: 60_000,
  })
}

/**
 * Log the current user out.
 *
 * Calls POST /auth/logout (best-effort — ignores network errors so the client
 * always clears), then wipes the Zustand auth store and invalidates all cached
 * queries. Callers redirect to /login after `mutate()` resolves.
 */
export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      try {
        await logout()
      } catch {
        // Best-effort: clear the client session regardless of network outcome.
      }
    },
    onSettled: () => {
      defaultAuthStore.getState().clear()
      queryClient.clear()
    },
  })
}
