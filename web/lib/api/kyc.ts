/**
 * KYC API client — calls POST /kyc/pin (pre-KYC transaction-PIN setup for a
 * verified-but-PIN-less session).
 *
 * Parses the request body through the contracts Zod schema before sending,
 * and parses the response after. The axios instance's request interceptor
 * sets Idempotency-Key automatically on every non-GET request.
 */
import {
  SetPinRequestSchema,
  SetPinResponseSchema,
  type SetPinResponse,
} from "@handshake-agent/contracts/dto"
import { api } from "./client"

export async function submitSetPin(pin: string): Promise<SetPinResponse> {
  // Parse body through the schema (UX gate — server is the security gate per §3.3)
  const validated = SetPinRequestSchema.parse({ pin })
  const { data } = await api.post("/kyc/pin", validated)
  return SetPinResponseSchema.parse(data)
}
