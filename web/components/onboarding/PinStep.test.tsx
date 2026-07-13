import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const setPinMutation = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))
vi.mock("@/lib/query/kyc", () => ({
  useSetPin: () => setPinMutation.current,
}))

import { PinStep } from "./PinStep"

async function fillPins(
  user: ReturnType<typeof userEvent.setup>,
  pin: string,
  confirmPin: string
) {
  await user.type(screen.getByLabelText(/^create pin/i), pin)
  await user.type(screen.getByLabelText(/confirm pin/i), confirmPin)
  await user.click(screen.getByRole("button", { name: /create account/i }))
}

describe("PinStep", () => {
  beforeEach(() => {
    setPinMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue({ hasPin: true }),
      isPending: false,
    }
  })

  it("rejects a mismatched confirmation client-side", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<PinStep onNext={onNext} onBack={vi.fn()} />)

    await fillPins(user, "2468", "2469")

    expect(await screen.findByText(/don't match/i)).toBeInTheDocument()
    expect(setPinMutation.current.mutateAsync).not.toHaveBeenCalled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("rejects a weak PIN client-side (all same digit)", async () => {
    const user = userEvent.setup()
    render(<PinStep onNext={vi.fn()} onBack={vi.fn()} />)

    await fillPins(user, "1111", "1111")

    expect(
      await screen.findByText(/must not be all the same digit/i)
    ).toBeInTheDocument()
    expect(setPinMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("submits a valid PIN and advances", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<PinStep onNext={onNext} onBack={vi.fn()} />)

    await fillPins(user, "2468", "2468")

    expect(setPinMutation.current.mutateAsync).toHaveBeenCalledWith("2468")
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("surfaces the backend's weak-PIN rejection inline", async () => {
    setPinMutation.current.mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("PIN must not be a simple sequence"))
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<PinStep onNext={onNext} onBack={vi.fn()} />)

    await fillPins(user, "2468", "2468")

    expect(
      await screen.findByText(/must not be a simple sequence/i)
    ).toBeInTheDocument()
    expect(onNext).not.toHaveBeenCalled()
  })

  it("calls onBack when Back is clicked", async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(<PinStep onNext={vi.fn()} onBack={onBack} />)
    await user.click(screen.getByRole("button", { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
