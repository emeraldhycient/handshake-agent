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
  RefreshRequestSchema,
  RefreshResponseSchema,
  type RefreshRequest,
  type RefreshResponse,
  MeResponseSchema,
  type MeResponse,
} from "@handshake-agent/contracts/auth"
import { api } from "./client"

export async function submitSignup(
  body: SignupRequest,
): Promise<SignupResponse> {
  const validated = SignupRequestSchema.parse(body)
  const { data } = await api.post("/auth/signup", validated)
  return SignupResponseSchema.parse(data)
}

export async function submitVerifyEmail(
  body: VerifyEmailRequest,
): Promise<VerifyEmailResponse> {
  const validated = VerifyEmailRequestSchema.parse(body)
  const { data } = await api.post("/auth/verify-email", validated)
  return VerifyEmailResponseSchema.parse(data)
}

export async function submitLoginRequest(
  body: LoginRequest,
): Promise<LoginRequestResponse> {
  const validated = LoginRequestSchema.parse(body)
  const { data } = await api.post("/auth/login/request", validated)
  return LoginRequestResponseSchema.parse(data)
}

export async function submitLoginVerify(
  body: LoginVerifyRequest,
): Promise<LoginVerifyResponse> {
  const validated = LoginVerifyRequestSchema.parse(body)
  const { data } = await api.post("/auth/login/verify", validated)
  return LoginVerifyResponseSchema.parse(data)
}

export async function refreshSession(
  refreshToken: string,
): Promise<RefreshResponse> {
  const body: RefreshRequest = { refreshToken }
  const validated = RefreshRequestSchema.parse(body)
  const { data } = await api.post("/auth/refresh", validated)
  return RefreshResponseSchema.parse(data)
}

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await api.get("/auth/me")
  return MeResponseSchema.parse(data)
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout")
}
