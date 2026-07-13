/**
 * TanStack Query hooks for KYC mutations.
 *
 * Wraps submitSetPin from lib/api/kyc so components never touch the api client
 * directly. Idempotency-Key is set by the axios interceptor.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { submitSetPin } from "@/lib/api/kyc"
import { qk } from "./keys"

export function useSetPin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pin: string) => submitSetPin(pin),
    onSuccess: () => {
      // Refetch /me so hasPin reflects the new PIN immediately.
      void queryClient.invalidateQueries({ queryKey: qk.me })
    },
  })
}
