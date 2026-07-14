/**
 * Profile-settings API client — self-service account management.
 *
 *   updateProfile(body)          → PATCH  /profile                    (phone / display currency)
 *   changePin(body)              → POST   /profile/pin/change         (204)
 *   listProfileSessions()        → GET    /profile/sessions
 *   revokeProfileSession(id)     → DELETE /profile/sessions/:id       (204)
 *   listPats()                   → GET    /profile/tokens             (masked)
 *   createPat(body)              → POST   /profile/tokens             (raw token — shown once)
 *   revokePat(id)                → DELETE /profile/tokens/:id         (204)
 *   getPublicNicknames()         → GET    /profile/public-nicknames
 *   createPublicNickname(body)   → POST   /profile/public-nicknames
 *   deletePublicNickname(id)     → DELETE /profile/public-nicknames/:id (204)
 *   changePayId(body)            → PATCH  /profile/payid              (204 — one change only, Spec 2)
 *
 * Parses request bodies through the contracts Zod schemas before sending and
 * responses after (UX gate — the server re-verifies per §3.3; PIN-bearing
 * bodies are verified through the lockout-protected PinService server-side).
 * The axios instance sets Idempotency-Key on every non-GET request.
 */
import {
  ChangePinRequestSchema,
  ClaimPayIdSchema,
  CreatePatRequestSchema,
  CreatePatResponseSchema,
  CreatePublicNicknameSchema,
  PatListResponseSchema,
  ProfileResponseSchema,
  ProfileSessionListResponseSchema,
  PublicNicknameSchema,
  PublicNicknamesResponseSchema,
  UpdateProfileRequestSchema,
  type ChangePinRequest,
  type ClaimPayId,
  type CreatePatRequest,
  type CreatePatResponse,
  type CreatePublicNickname,
  type PatListResponse,
  type ProfileResponse,
  type ProfileSessionListResponse,
  type PublicNickname,
  type PublicNicknamesResponse,
  type UpdateProfileRequest,
} from "@handshake-agent/contracts"
import { api } from "./client"

export async function updateProfile(
  body: UpdateProfileRequest
): Promise<ProfileResponse> {
  const validated = UpdateProfileRequestSchema.parse(body)
  const { data } = await api.patch("/profile", validated)
  return ProfileResponseSchema.parse(data)
}

export async function changePin(body: ChangePinRequest): Promise<void> {
  const validated = ChangePinRequestSchema.parse(body)
  await api.post("/profile/pin/change", validated)
}

export async function listProfileSessions(): Promise<ProfileSessionListResponse> {
  const { data } = await api.get("/profile/sessions")
  return ProfileSessionListResponseSchema.parse(data)
}

export async function revokeProfileSession(id: string): Promise<void> {
  await api.delete(`/profile/sessions/${id}`)
}

export async function listPats(): Promise<PatListResponse> {
  const { data } = await api.get("/profile/tokens")
  return PatListResponseSchema.parse(data)
}

export async function createPat(
  body: CreatePatRequest
): Promise<CreatePatResponse> {
  const validated = CreatePatRequestSchema.parse(body)
  const { data } = await api.post("/profile/tokens", validated)
  return CreatePatResponseSchema.parse(data)
}

export async function revokePat(id: string): Promise<void> {
  await api.delete(`/profile/tokens/${id}`)
}

export async function getPublicNicknames(): Promise<PublicNicknamesResponse> {
  const { data } = await api.get("/profile/public-nicknames")
  return PublicNicknamesResponseSchema.parse(data)
}

export async function createPublicNickname(
  body: CreatePublicNickname
): Promise<PublicNickname> {
  const validated = CreatePublicNicknameSchema.parse(body)
  const { data } = await api.post("/profile/public-nicknames", validated)
  return PublicNicknameSchema.parse(data)
}

export async function deletePublicNickname(id: string): Promise<void> {
  await api.delete(`/profile/public-nicknames/${id}`)
}

/**
 * PATCH /profile/payid — one-time PayID change. Returns 204 (no body): the
 * controller (`HandleController.changePayId`) is `@HttpCode(HttpStatus.NO_CONTENT)`
 * and returns `Promise<void>`, so there is nothing to parse on the response
 * side. Callers refetch the profile (`useChangePayId` invalidates it) to pick
 * up the new handle.
 */
export async function changePayId(body: ClaimPayId): Promise<void> {
  const validated = ClaimPayIdSchema.parse(body)
  await api.patch("/profile/payid", validated)
}
