/**
 * TanStack Query hook for the KYC complete mutation.
 *
 * Wraps submitKycComplete from lib/api/kyc so components never touch the
 * api client directly. Idempotency-Key is set by the axios interceptor.
 */
import { useMutation } from "@tanstack/react-query"
import type { KycCompleteRequest } from "@handshake-agent/contracts/dto"
import { submitKycComplete } from "@/lib/api/kyc"

export function useKycComplete() {
  return useMutation({
    mutationFn: (body: KycCompleteRequest) => submitKycComplete(body),
  })
}
