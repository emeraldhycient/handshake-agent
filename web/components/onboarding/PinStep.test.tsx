import { createRef } from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { PinStepKeypadHandle } from "@/types"

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

  it("renders Create account as the amber accent CTA", () => {
    render(<PinStep onNext={vi.fn()} onBack={vi.fn()} />)

    expect(
      screen.getByRole("button", { name: /create account/i })
    ).toHaveAttribute("data-variant", "accent")
  })
})

// ─── Mobile (Task FID-B) ────────────────────────────────────────────────────
// PinStep owns its entire PIN-entry state internally on mobile — the shell's
// on-screen Keypad routes taps through an imperative `PinStepKeypadHandle`
// ref, so these tests attach a plain ref and call its methods directly,
// exactly like the shell's real `onClick` handlers do.

function pinDots() {
  return document.querySelectorAll("[data-pin-dot]")
}

function filledPinDots() {
  return document.querySelectorAll('[data-pin-dot][data-state="filled"]')
}

function renderMobilePinStep(onNext = vi.fn(), onBack = vi.fn()) {
  const keypadRef = createRef<PinStepKeypadHandle>()
  render(<PinStep onNext={onNext} onBack={onBack} keypadRef={keypadRef} />)
  return keypadRef
}

function tapDigits(
  keypadRef: React.RefObject<PinStepKeypadHandle | null>,
  digits: string
) {
  for (const digit of digits) {
    act(() => keypadRef.current?.onDigit(digit))
  }
}

describe("PinStep — mobile (Task FID-B)", () => {
  beforeEach(() => {
    setPinMutation.current = {
      mutateAsync: vi.fn().mockResolvedValue({ hasPin: true }),
      isPending: false,
    }
  })

  it("renders 4 dots on the create screen instead of the desktop inputs", () => {
    renderMobilePinStep()

    expect(
      screen.getByRole("heading", { name: /create a transaction pin/i })
    ).toBeInTheDocument()
    expect(pinDots()).toHaveLength(4)
    expect(screen.queryByLabelText(/^create pin/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/confirm pin/i)).not.toBeInTheDocument()
  })

  it("reflects the entered create-pin digit count as filled dots", () => {
    const keypadRef = renderMobilePinStep()

    tapDigits(keypadRef, "24")

    expect(filledPinDots()).toHaveLength(2)
  })

  it("advances to the confirm stage once the create pin reaches 4 digits", () => {
    const keypadRef = renderMobilePinStep()

    tapDigits(keypadRef, "2468")

    expect(
      screen.getByRole("heading", { name: /confirm your pin/i })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/enter the same 4 digits once more/i)
    ).toBeInTheDocument()
    expect(filledPinDots()).toHaveLength(0)
  })

  it("submits and advances once the confirm pin matches", async () => {
    const onNext = vi.fn()
    const keypadRef = renderMobilePinStep(onNext)

    tapDigits(keypadRef, "2468")
    tapDigits(keypadRef, "2468")

    await waitFor(() => {
      expect(setPinMutation.current.mutateAsync).toHaveBeenCalledWith("2468")
    })
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
  })

  it("shows a mismatch message and clears the confirm buffer without submitting", async () => {
    const keypadRef = renderMobilePinStep()

    tapDigits(keypadRef, "2468")
    tapDigits(keypadRef, "1111")

    expect(
      await screen.findByText(/don't match — try again/i)
    ).toBeInTheDocument()
    expect(filledPinDots()).toHaveLength(0)
    expect(setPinMutation.current.mutateAsync).not.toHaveBeenCalled()
  })

  it("a new keystroke after a mismatch dismisses the mismatch message", () => {
    const keypadRef = renderMobilePinStep()

    tapDigits(keypadRef, "2468")
    tapDigits(keypadRef, "1111")
    expect(screen.getByText(/don't match — try again/i)).toBeInTheDocument()

    tapDigits(keypadRef, "9")

    expect(
      screen.queryByText(/don't match — try again/i)
    ).not.toBeInTheDocument()
  })

  it("surfaces a backend weak-PIN rejection inline and resets to the create screen", async () => {
    setPinMutation.current.mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("PIN must not be all the same digit"))
    const onNext = vi.fn()
    const keypadRef = renderMobilePinStep(onNext)

    tapDigits(keypadRef, "1111")
    tapDigits(keypadRef, "1111")

    expect(
      await screen.findByText(/must not be all the same digit/i)
    ).toBeInTheDocument()
    // Back on the create screen, with both buffers cleared for a fresh attempt.
    expect(
      screen.getByRole("heading", { name: /create a transaction pin/i })
    ).toBeInTheDocument()
    expect(pinDots()).toHaveLength(4)
    expect(filledPinDots()).toHaveLength(0)
    expect(onNext).not.toHaveBeenCalled()
  })

  it("handleBack returns to the create screen from confirm, and reports false on create", () => {
    const keypadRef = renderMobilePinStep()

    tapDigits(keypadRef, "2468")
    expect(
      screen.getByRole("heading", { name: /confirm your pin/i })
    ).toBeInTheDocument()

    let consumed = false
    act(() => {
      consumed = keypadRef.current?.handleBack() ?? false
    })
    expect(consumed).toBe(true)
    expect(
      screen.getByRole("heading", { name: /create a transaction pin/i })
    ).toBeInTheDocument()

    act(() => {
      consumed = keypadRef.current?.handleBack() ?? false
    })
    expect(consumed).toBe(false)
  })
})
