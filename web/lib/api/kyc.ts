/**
 * KYC API client — calls POST /kyc/complete (handoff-token flow),
 * POST /kyc/submit (session-auth flow), and POST /kyc/pin (pre-KYC
 * transaction-PIN setup for a verified-but-PIN-less session).
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after. The axios instance's request interceptor
 * sets Idempotency-Key automatically on every non-GET request.
 */
import {
  KycCompleteRequestSchema,
  KycCompleteResponseSchema,
  KycSubmitRequestSchema,
  SetPinRequestSchema,
  SetPinResponseSchema,
  type KycCompleteRequest,
  type KycCompleteResponse,
  type KycSubmitRequest,
  type SetPinResponse,
} from "@handshake-agent/contracts/dto"
import { api } from "./client"

export async function submitKycComplete(
  body: KycCompleteRequest
): Promise<KycCompleteResponse> {
  // Parse body through the schema (UX gate — server is the security gate per §3.3)
  const validated = KycCompleteRequestSchema.parse(body)
  const { data } = await api.post("/kyc/complete", validated)
  return KycCompleteResponseSchema.parse(data)
}

export async function submitKycSession(
  body: KycSubmitRequest
): Promise<KycCompleteResponse> {
  // Parse body through the schema (UX gate — server is the security gate per §3.3)
  const validated = KycSubmitRequestSchema.parse(body)
  const { data } = await api.post("/kyc/submit", validated)
  return KycCompleteResponseSchema.parse(data)
}

export async function submitSetPin(pin: string): Promise<SetPinResponse> {
  // Parse body through the schema (UX gate — server is the security gate per §3.3)
  const validated = SetPinRequestSchema.parse({ pin })
  const { data } = await api.post("/kyc/pin", validated)
  return SetPinResponseSchema.parse(data)
}
