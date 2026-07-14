import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Keypad } from "./Keypad"

describe("Keypad", () => {
  it("renders a 3x4 grid with digits 0-9 and a backspace key", () => {
    render(<Keypad onDigit={vi.fn()} onBackspace={vi.fn()} />)

    for (const digit of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
      expect(screen.getByRole("button", { name: digit })).toBeInTheDocument()
    }
    expect(
      screen.getByRole("button", { name: /backspace/i })
    ).toBeInTheDocument()
  })

  it("calls onDigit with the tapped digit", async () => {
    const user = userEvent.setup()
    const onDigit = vi.fn()
    render(<Keypad onDigit={onDigit} onBackspace={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "7" }))

    expect(onDigit).toHaveBeenCalledTimes(1)
    expect(onDigit).toHaveBeenCalledWith("7")
  })

  it("calls onDigit with '0' when the 0 key is tapped", async () => {
    const user = userEvent.setup()
    const onDigit = vi.fn()
    render(<Keypad onDigit={onDigit} onBackspace={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "0" }))

    expect(onDigit).toHaveBeenCalledTimes(1)
    expect(onDigit).toHaveBeenCalledWith("0")
  })

  it("calls onBackspace when the backspace key is tapped", async () => {
    const user = userEvent.setup()
    const onBackspace = vi.fn()
    render(<Keypad onDigit={vi.fn()} onBackspace={onBackspace} />)

    await user.click(screen.getByRole("button", { name: /backspace/i }))

    expect(onBackspace).toHaveBeenCalledTimes(1)
  })

  it("disables every key when disabled", () => {
    render(<Keypad onDigit={vi.fn()} onBackspace={vi.fn()} disabled />)

    expect(screen.getByRole("button", { name: "5" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /backspace/i })).toBeDisabled()
  })

  it("keys are enabled by default (disabled is optional)", () => {
    render(<Keypad onDigit={vi.fn()} onBackspace={vi.fn()} />)

    expect(screen.getByRole("button", { name: "3" })).toBeEnabled()
  })
})
