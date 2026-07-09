import { render, screen, waitFor } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"

// ── Mocks: the form's data + capability hooks and the device fingerprint ──────
const addBankMutate = vi.fn()
const useBanks = vi.fn()
const useConfig = vi.fn()
const useProfile = vi.fn()

vi.mock("@/lib/query/beneficiaries", () => ({
  useAddBankAccount: () => ({
    mutateAsync: addBankMutate,
    isPending: false,
    isError: false,
  }),
  useBanks: (...a: unknown[]) => useBanks(...a),
}))
vi.mock("@/lib/query/hooks", () => ({ useConfig: () => useConfig() }))
vi.mock("@/lib/query/auth", () => ({ useProfile: () => useProfile() }))
vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: () => "web-test-fingerprint",
}))

import { AddBankForm } from "./add-bank-form"

const GTB = { name: "GTBank", code: "058" }

function fiat(code: string) {
  return { code, displayName: code, symbol: code, decimals: 2 }
}

beforeEach(() => {
  addBankMutate.mockReset()
  useConfig.mockReturnValue({ data: { fiats: [fiat("NGN"), fiat("KES")] } })
  useProfile.mockReturnValue({ data: { fiatCurrency: "NGN" } })
  useBanks.mockReturnValue({
    data: { banks: [GTB] },
    isPending: false,
    isError: false,
  })
})

async function fillCoreFields(user: UserEvent, pin = "1379") {
  await user.type(screen.getByLabelText("Account number"), "0123456789")
  await user.selectOptions(screen.getByLabelText("Bank"), "058")
  await user.type(screen.getByLabelText("Label"), "My GTB")
  if (pin) await user.type(screen.getByLabelText("Transaction PIN"), pin)
}

describe("AddBankForm", () => {
  it("loads the bank list for the selected country and lets you pick one", async () => {
    const user = userEvent.setup()
    render(<AddBankForm onResolve={vi.fn()} />)

    // Default currency = profile NGN → banks fetched for NG.
    expect(useBanks).toHaveBeenCalledWith("NG")
    const bankSelect = screen.getByLabelText("Bank") as HTMLSelectElement
    await user.selectOptions(bankSelect, "058")
    expect(bankSelect.value).toBe("058")
  })

  it("defaults the currency to the user's profile currency and fetches that country's banks", () => {
    useProfile.mockReturnValue({ data: { fiatCurrency: "KES" } })
    render(<AddBankForm onResolve={vi.fn()} />)

    const currency = screen.getByLabelText(
      "Country / currency"
    ) as HTMLSelectElement
    expect(currency.value).toBe("KES")
    expect(useBanks).toHaveBeenCalledWith("KE")
  })

  it("requires a PIN — an empty PIN blocks submit with a field error", async () => {
    const user = userEvent.setup()
    render(<AddBankForm onResolve={vi.fn()} />)
    await fillCoreFields(user, "") // no PIN

    await user.click(screen.getByRole("button", { name: /add bank account/i }))

    expect(
      await screen.findByText(/PIN must be 4 to 6 digits/i)
    ).toBeInTheDocument()
    expect(addBankMutate).not.toHaveBeenCalled()
  })

  it("submits currency + pin + device fingerprint, confirms the resolved name, then resolves", async () => {
    addBankMutate.mockResolvedValue({
      id: "new-ben",
      accountHolderName: "ADA LOVELACE",
      accountNumber: "0123456789",
      bankCode: "058",
    })
    const onResolve = vi.fn()
    const user = userEvent.setup()
    render(<AddBankForm onResolve={onResolve} />)
    await fillCoreFields(user)

    await user.click(screen.getByRole("button", { name: /add bank account/i }))

    await waitFor(() => expect(addBankMutate).toHaveBeenCalled())
    expect(addBankMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountNumber: "0123456789",
        bankCode: "058",
        label: "My GTB",
        currency: "NGN",
        pin: "1379",
        deviceFingerprint: "web-test-fingerprint",
      })
    )

    // Name-enquiry confirm step — must NOT auto-resolve (funds-safety).
    const name = await screen.findByText(/ADA LOVELACE/)
    expect(name).toHaveAttribute("translate", "no")
    expect(onResolve).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", { name: /yes, that'?s correct/i })
    )
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("new-ben"))
  })

  it("maps a wrong-PIN (401) to distinct copy", async () => {
    const user = userEvent.setup()
    addBankMutate.mockRejectedValue(new ApiError("nope", 401))
    render(<AddBankForm onResolve={vi.fn()} />)
    await fillCoreFields(user)

    await user.click(screen.getByRole("button", { name: /add bank account/i }))

    expect(
      await screen.findByText(/that PIN is incorrect/i)
    ).toBeInTheDocument()
  })

  it("maps a locked PIN (PIN_LOCKED) to distinct copy", async () => {
    const user = userEvent.setup()
    addBankMutate.mockRejectedValue(new ApiError("locked", 401, "PIN_LOCKED"))
    render(<AddBankForm onResolve={vi.fn()} />)
    await fillCoreFields(user)

    await user.click(screen.getByRole("button", { name: /add bank account/i }))

    expect(await screen.findByText(/temporarily locked/i)).toBeInTheDocument()
  })

  it("shows a loading branch while the bank list is pending", () => {
    useBanks.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    })
    render(<AddBankForm onResolve={vi.fn()} />)
    expect(screen.getByText(/Loading banks…/i)).toBeInTheDocument()
  })

  it("surfaces an error branch when a non-NG bank list fails (no offline fallback)", () => {
    useProfile.mockReturnValue({ data: { fiatCurrency: "KES" } })
    useBanks.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    render(<AddBankForm onResolve={vi.fn()} />)
    expect(
      screen.getByText(/couldn't load banks for this country/i)
    ).toBeInTheDocument()
  })

  it("falls back to the offline Nigerian bank list when the NG list fails", () => {
    useBanks.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })
    render(<AddBankForm onResolve={vi.fn()} />)
    // A canonical NG bank from NIGERIAN_BANKS must still be selectable.
    expect(
      screen.getByRole("option", { name: /Guaranty Trust Bank/i })
    ).toBeInTheDocument()
  })

  it("hides the currency picker when only one currency is offered", () => {
    useConfig.mockReturnValue({ data: { fiats: [fiat("NGN")] } })
    render(<AddBankForm onResolve={vi.fn()} />)
    expect(
      screen.queryByLabelText("Country / currency")
    ).not.toBeInTheDocument()
  })
})
