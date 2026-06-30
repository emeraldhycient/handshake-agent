import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const listBeneficiaries = vi.fn()
const addBankAccount = vi.fn()
const addCryptoAddress = vi.fn()
const deleteBeneficiary = vi.fn()
vi.mock("@/lib/api/beneficiaries", () => ({
  listBeneficiaries: (...a: unknown[]) => listBeneficiaries(...a),
  addBankAccount: (...a: unknown[]) => addBankAccount(...a),
  addCryptoAddress: (...a: unknown[]) => addCryptoAddress(...a),
  deleteBeneficiary: (...a: unknown[]) => deleteBeneficiary(...a),
}))

import {
  useBeneficiaries,
  useAddBankAccount,
  useAddCryptoAddress,
  useDeleteBeneficiary,
} from "./beneficiaries"

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("beneficiaries query hooks", () => {
  beforeEach(() => {
    listBeneficiaries.mockReset()
    addBankAccount.mockReset()
    addCryptoAddress.mockReset()
    deleteBeneficiary.mockReset()
  })

  it("useBeneficiaries loads the list for the given type", async () => {
    listBeneficiaries.mockResolvedValue({ beneficiaries: [{ id: "b1" }] })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useBeneficiaries("bank_account"), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(listBeneficiaries).toHaveBeenCalledWith("bank_account")
    expect(result.current.data?.beneficiaries).toHaveLength(1)
  })

  it("useBeneficiaries does not fetch when disabled", () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useBeneficiaries("crypto_address", false), { wrapper })
    expect(listBeneficiaries).not.toHaveBeenCalled()
  })

  it("useAddBankAccount invalidates the bank list on success", async () => {
    addBankAccount.mockResolvedValue({ id: "b1" })
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useAddBankAccount(), { wrapper })
    await result.current.mutateAsync({
      accountNumber: "0123456789",
      bankCode: "058",
      label: "x",
    })
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["beneficiaries", "bank_account"],
    })
  })

  it("useAddCryptoAddress invalidates the crypto list on success", async () => {
    addCryptoAddress.mockResolvedValue({ id: "c1" })
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useAddCryptoAddress(), { wrapper })
    await result.current.mutateAsync({
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      network: "TRON",
      asset: "USDT",
      label: "x",
    })
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["beneficiaries", "crypto_address"],
    })
  })

  it("useDeleteBeneficiary deletes by id and invalidates BOTH lists", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    deleteBeneficiary.mockResolvedValue({ id, deleted: true })
    const { client, wrapper } = makeWrapper()
    const spy = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useDeleteBeneficiary(), { wrapper })

    await result.current.mutateAsync(id)

    expect(deleteBeneficiary).toHaveBeenCalledWith(id)
    // A removed beneficiary must disappear from whichever picker shows it; the
    // hook does not know the type, so it invalidates both list keys.
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["beneficiaries", "bank_account"],
    })
    expect(spy).toHaveBeenCalledWith({
      queryKey: ["beneficiaries", "crypto_address"],
    })
  })
})
