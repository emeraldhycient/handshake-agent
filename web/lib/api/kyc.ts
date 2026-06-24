/**
 * KYC API client — the only place that calls POST /kyc/complete.
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after. The axios instance's request interceptor
 * sets Idempotency-Key automatically on every non-GET request.
 */
import {
  KycCompleteRequestSchema,
  KycCompleteResponseSchema,
  type KycCompleteRequest,
  type KycCompleteResponse,
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
