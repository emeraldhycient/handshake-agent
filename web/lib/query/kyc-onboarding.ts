/**
 * TanStack Query hooks for the onboarding KYC mutations (set-name and
 * Sumsub-token minting).
 *
 * Wraps submitName / fetchSumsubToken from lib/api/kyc-onboarding so
 * components never touch the api client directly.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type {
  KycTierLevel,
  SetNameRequest,
} from "@handshake-agent/contracts/dto"
import { fetchSumsubToken, submitName } from "@/lib/api/kyc-onboarding"
import { qk } from "./keys"

export function useSetName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SetNameRequest) => submitName(body),
    onSuccess: () => {
      // Refetch /me so the cached identity reflects the newly set name.
      void queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
}

export function useSumsubToken() {
  return useMutation({
    mutationFn: (level: KycTierLevel) => fetchSumsubToken(level),
  })
}
