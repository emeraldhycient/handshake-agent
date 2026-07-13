/**
 * Auth API client — the single place that calls the auth endpoints.
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after. The axios instance's request interceptor
 * sets Idempotency-Key automatically on every non-GET request.
 */
import {
  SignupRequestSchema,
  SignupResponseSchema,
  type SignupRequest,
  type SignupResponse,
  VerifyEmailRequestSchema,
  VerifyEmailResponseSchema,
  type VerifyEmailRequest,
  type VerifyEmailResponse,
  LoginRequestSchema,
  LoginRequestResponseSchema,
  type LoginRequest,
  type LoginRequestResponse,
  LoginVerifyRequestSchema,
  LoginVerifyResponseSchema,
  type LoginVerifyRequest,
  type LoginVerifyResponse,
  SignupVerifyRequestSchema,
  type SignupVerifyRequest,
  RefreshResponseSchema,
  type RefreshResponse,
  MeResponseSchema,
  type MeResponse,
} from "@handshake-agent/contracts/auth"
import {
  ProfileResponseSchema,
  type ProfileResponse,
} from "@handshake-agent/contracts"
import { api } from "./client"

export async function submitSignup(
  body: SignupRequest
): Promise<SignupResponse> {
  const validated = SignupRequestSchema.parse(body)
  const { data } = await api.post("/auth/signup", validated)
  return SignupResponseSchema.parse(data)
}

export async function submitVerifyEmail(
  body: VerifyEmailRequest
): Promise<VerifyEmailResponse> {
  const validated = VerifyEmailRequestSchema.parse(body)
  const { data } = await api.post("/auth/verify-email", validated)
  return VerifyEmailResponseSchema.parse(data)
}

export async function submitLoginRequest(
  body: LoginRequest
): Promise<LoginRequestResponse> {
  const validated = LoginRequestSchema.parse(body)
  const { data } = await api.post("/auth/login/request", validated)
  return LoginRequestResponseSchema.parse(data)
}

export async function submitLoginVerify(
  body: LoginVerifyRequest
): Promise<LoginVerifyResponse> {
  const validated = LoginVerifyRequestSchema.parse(body)
  const { data } = await api.post("/auth/login/verify", validated)
  return LoginVerifyResponseSchema.parse(data)
}

/**
 * Request an OTP for the email→OTP→session signup flow (onboarding wizard).
 *
 * Mirrors submitLoginRequest exactly, but hits the additive OTP-signup
 * endpoint — the legacy link-based `/auth/signup` (submitSignup above) stays
 * untouched. Reuses SignupRequestSchema (email required, phone optional) and
 * parses only `{ email }` through it, since phone is not collected here.
 */
export async function submitSignupRequest(
  email: string
): Promise<LoginRequestResponse> {
  const validated = SignupRequestSchema.parse({ email })
  const { data } = await api.post("/auth/signup/request", validated)
  return LoginRequestResponseSchema.parse(data)
}

/**
 * Verify the signup OTP and mint a session. Mirrors submitLoginVerify exactly;
 * the response shape is identical (SignupVerifyResponseSchema === LoginVerifyResponseSchema).
 */
export async function submitSignupVerify(
  body: SignupVerifyRequest
): Promise<LoginVerifyResponse> {
  const validated = SignupVerifyRequestSchema.parse(body)
  const { data } = await api.post("/auth/signup/verify", validated)
  return LoginVerifyResponseSchema.parse(data)
}

/**
 * Refresh the session (Wave H: cookie-carried refresh).
 *
 * POSTs /auth/refresh with NO body — the rotating refresh token rides in the
 * HttpOnly `ha_refresh` cookie, which the browser sends automatically because
 * the axios instance uses `withCredentials`. The response carries a fresh access
 * token AND the user projection, so boot rehydration completes in one round-trip
 * (no separate GET /auth/me needed).
 */
export async function refreshSession(): Promise<RefreshResponse> {
  const { data } = await api.post("/auth/refresh")
  return RefreshResponseSchema.parse(data)
}

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await api.get("/auth/me")
  return MeResponseSchema.parse(data)
}

export async function fetchProfile(): Promise<ProfileResponse> {
  const { data } = await api.get("/profile")
  return ProfileResponseSchema.parse(data)
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout")
}
