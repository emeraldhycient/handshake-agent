import { render, screen, waitFor } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/client"

const addCryptoMutate = vi.fn()
vi.mock("@/lib/query/beneficiaries", () => ({
  useAddCryptoAddress: () => ({
    mutateAsync: addCryptoMutate,
    isPending: false,
    isError: false,
  }),
}))
vi.mock("@/lib/device", () => ({
  getDeviceFingerprint: () => "web-test-fingerprint",
}))

import { AddCryptoForm } from "./add-crypto-form"

const ADDRESS = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"

async function fill(user: UserEvent, pin = "1379") {
  await user.type(screen.getByLabelText("USDT address (TRON)"), ADDRESS)
  await user.type(screen.getByLabelText("Label"), "Cold wallet")
  if (pin) await user.type(screen.getByLabelText("Transaction PIN"), pin)
}

describe("AddCryptoForm", () => {
  beforeEach(() => {
    addCryptoMutate.mockReset()
  })

  it("requires a PIN — an empty PIN blocks submit with a field error", async () => {
    const user = userEvent.setup()
    render(<AddCryptoForm onResolve={vi.fn()} />)
    await fill(user, "")

    await user.click(screen.getByRole("button", { name: /add address/i }))

    expect(
      await screen.findByText(/PIN must be 4 to 6 digits/i)
    ).toBeInTheDocument()
    expect(addCryptoMutate).not.toHaveBeenCalled()
  })

  it("submits pin + device fingerprint and resolves immediately on success", async () => {
    const user = userEvent.setup()
    addCryptoMutate.mockResolvedValue({ id: "crypto-ben" })
    const onResolve = vi.fn()
    render(<AddCryptoForm onResolve={onResolve} />)
    await fill(user)

    await user.click(screen.getByRole("button", { name: /add address/i }))

    await waitFor(() => expect(addCryptoMutate).toHaveBeenCalled())
    expect(addCryptoMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        address: ADDRESS,
        network: "TRON",
        asset: "USDT",
        label: "Cold wallet",
        pin: "1379",
        deviceFingerprint: "web-test-fingerprint",
      })
    )
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith("crypto-ben"))
  })

  it("maps a wrong-PIN (401) to distinct copy", async () => {
    const user = userEvent.setup()
    addCryptoMutate.mockRejectedValue(new ApiError("nope", 401))
    render(<AddCryptoForm onResolve={vi.fn()} />)
    await fill(user)

    await user.click(screen.getByRole("button", { name: /add address/i }))

    expect(
      await screen.findByText(/that PIN is incorrect/i)
    ).toBeInTheDocument()
  })
})
