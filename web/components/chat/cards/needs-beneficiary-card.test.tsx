import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the query hooks so the card renders without a real QueryClient/network.
const useBeneficiaries = vi.fn()
const addBankMutate = vi.fn()
const addCryptoMutate = vi.fn()
const useAddBankAccount = vi.fn(() => ({
  mutateAsync: addBankMutate,
  isPending: false,
  isError: false,
}))
const useAddCryptoAddress = vi.fn(() => ({
  mutateAsync: addCryptoMutate,
  isPending: false,
  isError: false,
}))
vi.mock("@/lib/query/beneficiaries", () => ({
  useBeneficiaries: (...a: unknown[]) => useBeneficiaries(...a),
  useAddBankAccount: () => useAddBankAccount(),
  useAddCryptoAddress: () => useAddCryptoAddress(),
}))

import { NeedsBeneficiaryCard } from "./needs-beneficiary-card"

describe("NeedsBeneficiaryCard", () => {
  beforeEach(() => {
    useBeneficiaries.mockReset()
    addBankMutate.mockReset()
    addCryptoMutate.mockReset()
  })

  it("renders existing bank beneficiaries and resolves on select", async () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        beneficiaries: [
          {
            id: "ben-1",
            type: "bank_account",
            label: "My GTB",
            accountNumber: "0123456789",
            bankCode: "058",
          },
        ],
      },
    })
    const onResolve = vi.fn()
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="bank_account"
        density="mobile"
        onResolve={onResolve}
      />
    )

    await userEvent.click(screen.getByRole("button", { name: /My GTB/i }))
    expect(onResolve).toHaveBeenCalledWith("ben-1")
  })

  it("shows the empty state when there are no saved destinations", () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: { beneficiaries: [] },
    })
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="crypto_address"
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    expect(screen.getByText(/No saved addresses yet/i)).toBeInTheDocument()
  })

  it("adds a bank account and resolves with the new id", async () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: { beneficiaries: [] },
    })
    addBankMutate.mockResolvedValue({ id: "new-ben" })
    const onResolve = vi.fn()
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="bank_account"
        density="mobile"
        onResolve={onResolve}
      />
    )

    await userEvent.type(screen.getByLabelText("Account number"), "0123456789")
    // Bank is now a dropdown (users don't know codes) — pick GTBank (code 058).
    await userEvent.selectOptions(screen.getByLabelText("Bank"), "058")
    await userEvent.type(screen.getByLabelText("Label"), "My GTB")
    await userEvent.click(
      screen.getByRole("button", { name: /add bank account/i })
    )

    await waitFor(() => expect(addBankMutate).toHaveBeenCalled())
    expect(addBankMutate).toHaveBeenCalledWith({
      accountNumber: "0123456789",
      bankCode: "058",
      label: "My GTB",
    })
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("new-ben"))
  })

  it("shows a loading branch while the list is pending", () => {
    useBeneficiaries.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    })
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="bank_account"
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    expect(screen.getByText(/Loading saved destinations/i)).toBeInTheDocument()
  })
})
