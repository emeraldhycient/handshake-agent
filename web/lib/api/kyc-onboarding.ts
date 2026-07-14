/**
 * Onboarding KYC API client — set-name and Sumsub-token minting.
 *
 * POST /profile/name        set the KYC-profile display name (pre-KYC step)
 * POST /kyc/sumsub/token    mint a Sumsub WebSDK access token for a tier_2/
 *                           tier_3 verification upgrade
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after (UX gate — the server is the security gate
 * per root CLAUDE.md §3.3). The axios instance's request interceptor sets
 * Idempotency-Key automatically on every non-GET request.
 */
import {
  SetNameRequestSchema,
  SumsubTokenRequestSchema,
  SumsubTokenResponseSchema,
  type KycTierLevel,
  type SetNameRequest,
  type SumsubTokenResponse,
} from "@handshake-agent/contracts/dto"
import { api } from "./client"

export async function submitName(
  body: SetNameRequest
): Promise<SetNameRequest> {
  const validated = SetNameRequestSchema.parse(body)
  const { data } = await api.post("/profile/name", validated)
  // The endpoint echoes back the persisted names — same shape as the request.
  return SetNameRequestSchema.parse(data)
}

export async function fetchSumsubToken(
  level: KycTierLevel
): Promise<SumsubTokenResponse> {
  const validated = SumsubTokenRequestSchema.parse({ level })
  const { data } = await api.post("/kyc/sumsub/token", validated)
  return SumsubTokenResponseSchema.parse(data)
}
