/**
 * TanStack Query hooks for the onboarding KYC mutations (set-name and
 * Sumsub-token minting).
 *
 * Wraps submitName / fetchSumsubToken from lib/api/kyc-onboarding so
 * components never touch the api client directly.
 */
import { useCallback } from "react"
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

/**
 * Invalidate the cached identity (`/me` + `/profile`) so KYC tier / status
 * re-fetch. Called after a Sumsub submission — the tier is granted server-side
 * off the webhook (root §3.1), so the client just re-reads until it catches up.
 */
export function useRefreshIdentity() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.me })
    void queryClient.invalidateQueries({ queryKey: qk.profile })
  }, [queryClient])
}
