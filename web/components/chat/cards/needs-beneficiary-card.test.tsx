import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the query hooks so the card renders without a real QueryClient/network.
const useBeneficiaries = vi.fn()
const addBankMutate = vi.fn()
const addCryptoMutate = vi.fn()
const deleteMutate = vi.fn()
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
const useDeleteBeneficiary = vi.fn(() => ({
  mutate: deleteMutate,
  mutateAsync: deleteMutate,
  isPending: false,
  isError: false,
}))
vi.mock("@/lib/query/beneficiaries", () => ({
  useBeneficiaries: (...a: unknown[]) => useBeneficiaries(...a),
  useAddBankAccount: () => useAddBankAccount(),
  useAddCryptoAddress: () => useAddCryptoAddress(),
  useDeleteBeneficiary: () => useDeleteBeneficiary(),
}))

import { NeedsBeneficiaryCard } from "./needs-beneficiary-card"

describe("NeedsBeneficiaryCard", () => {
  beforeEach(() => {
    useBeneficiaries.mockReset()
    addBankMutate.mockReset()
    addCryptoMutate.mockReset()
    deleteMutate.mockReset()
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

    // The select-row's accessible name includes the account number; the remove
    // button is "Remove My GTB" — match the row specifically.
    await userEvent.click(
      screen.getByRole("button", { name: /My GTB0123456789/i })
    )
    // No messageId prop here → the second arg is undefined (legacy callers).
    expect(onResolve).toHaveBeenCalledWith("ben-1", undefined)
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

  it("adds a bank account, confirms the resolved account name, then resolves", async () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: { beneficiaries: [] },
    })
    // The POST /bank-account response carries the server-resolved account holder
    // name (name-enquiry). The card must show it and require explicit confirm.
    addBankMutate.mockResolvedValue({
      id: "new-ben",
      accountHolderName: "ADA LOVELACE",
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

    // The resolved name is shown and onResolve must NOT have fired yet — the
    // user has to confirm the name belongs to them (funds-safety, prevents a
    // typo paying a stranger).
    const resolvedName = await screen.findByText(/ADA LOVELACE/)
    expect(resolvedName).toBeInTheDocument()
    expect(onResolve).not.toHaveBeenCalled()

    // The confirm-step name and account number must be excluded from
    // translation — Google Translate must never reformat the identity/number
    // the user is confirming before money moves (§3.1 funds-safety).
    expect(resolvedName).toHaveAttribute("translate", "no")
    expect(resolvedName.nextElementSibling).toHaveAttribute("translate", "no")

    await userEvent.click(
      screen.getByRole("button", { name: /yes, that'?s correct/i })
    )
    await waitFor(() =>
      expect(onResolve).toHaveBeenCalledWith("new-ben", undefined)
    )
  })

  it("lets the user delete a saved beneficiary (DELETE mutation by id)", async () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        beneficiaries: [
          {
            id: "ben-del",
            type: "bank_account",
            label: "Stale GTB",
            accountNumber: "0123456789",
            bankCode: "058",
          },
        ],
      },
    })
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="bank_account"
        density="mobile"
        onResolve={vi.fn()}
      />
    )

    // Each saved row has a remove control labelled for accessibility.
    await userEvent.click(
      screen.getByRole("button", { name: /remove Stale GTB/i })
    )
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith("ben-del"))
  })

  it("passes the card's messageId to onResolve so the right intent resumes", async () => {
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
        messageId="msg-42"
        onResolve={onResolve}
      />
    )

    await userEvent.click(
      screen.getByRole("button", { name: /My GTB0123456789/i })
    )
    expect(onResolve).toHaveBeenCalledWith("ben-1", "msg-42")
  })

  it("renders the server's targeted note in place of the generic copy (nickname miss)", () => {
    useBeneficiaries.mockReturnValue({
      isPending: false,
      isError: false,
      data: { beneficiaries: [] },
    })
    const note =
      "No saved beneficiary called 'mum'. Add one first, or pick from your saved list."
    render(
      <NeedsBeneficiaryCard
        kind="needs_beneficiary"
        beneficiaryType="bank_account"
        note={note}
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    expect(screen.getByText(note)).toBeInTheDocument()
    // The generic line is replaced, not duplicated.
    expect(
      screen.queryByText(/Choose where you'd like the sale paid out/i)
    ).not.toBeInTheDocument()
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
