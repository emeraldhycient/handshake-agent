import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { BalanceHero } from "./balance-hero"

describe("BalanceHero", () => {
  it("shows the total balance label and value", () => {
    render(<BalanceHero total="₦1,000" canSell onQuickAction={() => {}} />)
    expect(screen.getByText(/Total balance/i)).toBeInTheDocument()
    expect(screen.getByText("₦1,000")).toBeInTheDocument()
  })

  it("renders all four actions when sell is enabled", () => {
    render(<BalanceHero total="₦0" canSell onQuickAction={() => {}} />)
    ;["Buy", "Send", "Receive", "Sell"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: "Swap" })
    ).not.toBeInTheDocument()
  })

  it("hides Sell when the capability is disabled", () => {
    render(<BalanceHero total="₦0" canSell={false} onQuickAction={() => {}} />)
    expect(
      screen.queryByRole("button", { name: "Sell" })
    ).not.toBeInTheDocument()
  })

  it("fires onQuickAction with the action and a label", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<BalanceHero total="₦0" canSell onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Buy" }))
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String))
  })

  it("fires onQuickAction('sell', ...) when Sell is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<BalanceHero total="₦0" canSell onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Sell" }))
    expect(onQuickAction).toHaveBeenCalledWith("sell", expect.any(String))
  })
})
