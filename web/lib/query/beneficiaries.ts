/**
 * TanStack Query hooks for beneficiaries.
 *
 * Wraps the lib/api/beneficiaries client so components never touch the api
 * directly. The add mutations invalidate the matching list query so a freshly
 * added beneficiary appears immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AddBankAccountRequest,
  AddCryptoAddressRequest,
  BeneficiaryType,
} from "@handshake-agent/contracts/beneficiaries"
import {
  listBeneficiaries,
  addBankAccount,
  addCryptoAddress,
  deleteBeneficiary,
} from "@/lib/api/beneficiaries"
import { qk } from "./keys"

/** Server state never goes stale faster than the user can add one — 30s. */
const STALE_TIME_MS = 30_000

export function useBeneficiaries(type: BeneficiaryType, enabled = true) {
  return useQuery({
    queryKey: qk.beneficiaries(type),
    queryFn: () => listBeneficiaries(type),
    staleTime: STALE_TIME_MS,
    enabled,
  })
}

export function useAddBankAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AddBankAccountRequest) => addBankAccount(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.beneficiaries("bank_account"),
      })
    },
  })
}

export function useAddCryptoAddress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AddCryptoAddressRequest) => addCryptoAddress(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.beneficiaries("crypto_address"),
      })
    },
  })
}

/**
 * Remove a saved beneficiary (soft-delete server-side). Invalidates BOTH list
 * keys: the hook is type-agnostic (it deletes by id) and a stale/typo'd row must
 * leave whichever picker is showing it.
 */
export function useDeleteBeneficiary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBeneficiary(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: qk.beneficiaries("bank_account"),
      })
      void queryClient.invalidateQueries({
        queryKey: qk.beneficiaries("crypto_address"),
      })
    },
  })
}
