import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BalanceHero } from "./balance-hero"

describe("BalanceHero", () => {
  it("shows the total balance label and value", () => {
    render(<BalanceHero total="₦1,000" canSwap onQuickAction={() => {}} />)
    expect(screen.getByText(/Total balance/i)).toBeInTheDocument()
    expect(screen.getByText("₦1,000")).toBeInTheDocument()
  })

  it("renders all four actions when swap is enabled", () => {
    render(<BalanceHero total="₦0" canSwap onQuickAction={() => {}} />)
    ;["Buy", "Send", "Receive", "Swap"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    )
  })

  it("hides Swap when the capability is disabled", () => {
    render(<BalanceHero total="₦0" canSwap={false} onQuickAction={() => {}} />)
    expect(
      screen.queryByRole("button", { name: "Swap" })
    ).not.toBeInTheDocument()
  })

  it("fires onQuickAction with the action and a label", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<BalanceHero total="₦0" canSwap onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Buy" }))
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })
})
