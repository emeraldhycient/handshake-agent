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
import {
  LoginRequestSchema,
  LoginRequestResponseSchema,
  SignupResponseSchema,
  type LoginRequest,
  type LoginVerifyRequest,
  type LoginRequestResponse,
  type SignupResponse,
  type SignupRequest,
  type SignupVerifyRequest,
  type VerifyEmailRequest,
} from "@handshake-agent/contracts/auth"
import {
  fetchMe,
  fetchProfile,
  logout,
  submitLoginRequest,
  submitLoginVerify,
  submitSignup,
  submitSignupRequest,
  submitSignupVerify,
  submitVerifyEmail,
} from "@/lib/api/auth"
import { api } from "@/lib/api/client"
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

/**
 * Resend the login OTP (POST /auth/login/resend).
 *
 * Idempotent + rate-limited server-side; gives the UI a one-click "request a new
 * code" affordance after a stale/wrong code or an OTP lockout (429 / OTP_LOCKED),
 * instead of forcing the user to restart the login flow. Reuses the login
 * request/response shapes (same email body → same `otp_sent` ack).
 *
 * Defined here (not in lib/api/auth.ts) but still parses the body before sending
 * and the response after — the FE gate is UX; the server is the security gate.
 */
export function useResendLoginOtp() {
  return useMutation({
    mutationFn: async (body: LoginRequest): Promise<LoginRequestResponse> => {
      const validated = LoginRequestSchema.parse(body)
      const { data } = await api.post("/auth/login/resend", validated)
      return LoginRequestResponseSchema.parse(data)
    },
  })
}

/**
 * Resend the email-verification link (POST /auth/verify-email/resend).
 *
 * Idempotent + rate-limited server-side. Powers the "Resend verification email"
 * affordance on the verify-email page so an expired/lost link does not push the
 * user to sign up again (which would feel like creating a duplicate account).
 * The body is just the email (the login request shape); the response is the
 * signup `pending_verification` ack.
 */
export function useResendVerification() {
  return useMutation({
    mutationFn: async (body: LoginRequest): Promise<SignupResponse> => {
      const validated = LoginRequestSchema.parse(body)
      const { data } = await api.post("/auth/verify-email/resend", validated)
      return SignupResponseSchema.parse(data)
    },
  })
}

export function useLoginVerify() {
  return useMutation({
    mutationFn: (body: LoginVerifyRequest) => submitLoginVerify(body),
    onSuccess: (data) => {
      // The refresh token in `data` is ignored — the browser already stored it
      // as the HttpOnly `ha_refresh` cookie from the login response's Set-Cookie.
      defaultAuthStore
        .getState()
        .setSession({ accessToken: data.accessToken, user: data.user })
    },
  })
}

/**
 * Request an OTP for the email→OTP→session signup flow (onboarding wizard).
 * Mirrors useLoginRequest exactly, but hits the additive OTP-signup endpoint.
 */
export function useSignupRequest() {
  return useMutation({
    mutationFn: (email: string) => submitSignupRequest(email),
  })
}

/**
 * Verify the signup OTP and mint a session. Mirrors useLoginVerify's
 * setSession-on-success behavior, and additionally invalidates the cached
 * `me` query so a subsequent useMe() re-fetches the freshly created identity
 * instead of holding a stale cache entry from before the session existed.
 */
export function useSignupVerify() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SignupVerifyRequest) => submitSignupVerify(body),
    onSuccess: (data) => {
      // The refresh token in `data` is ignored — the browser already stored it
      // as the HttpOnly `ha_refresh` cookie from the signup-verify response's
      // Set-Cookie.
      defaultAuthStore
        .getState()
        .setSession({ accessToken: data.accessToken, user: data.user })
      queryClient.invalidateQueries({ queryKey: qk.me })
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
