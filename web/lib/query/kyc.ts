/**
 * TanStack Query hooks for KYC mutations.
 *
 * Wraps submitKycComplete and submitKycSession from lib/api/kyc so components
 * never touch the api client directly. Idempotency-Key is set by the axios interceptor.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  KycCompleteRequest,
  KycSubmitRequest,
} from "@handshake-agent/contracts/dto"
import { submitKycComplete, submitKycSession } from "@/lib/api/kyc"
import { qk } from "./keys"

export function useKycComplete() {
  return useMutation({
    mutationFn: (body: KycCompleteRequest) => submitKycComplete(body),
  })
}

export function useKycSubmit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: KycSubmitRequest) => submitKycSession(body),
    onSuccess: () => {
      // Refetch /me so kycStatus reflects 'verified' immediately.
      void queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
}
