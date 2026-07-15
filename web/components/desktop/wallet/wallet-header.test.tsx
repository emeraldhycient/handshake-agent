import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WalletHeader } from "./wallet-header"

describe("WalletHeader", () => {
  it("renders the Wallet title and all four actions when sell is on", () => {
    render(<WalletHeader canSell onQuickAction={() => {}} />)
    expect(screen.getByRole("heading", { name: "Wallet" })).toBeInTheDocument()
    ;["Buy", "Send", "Receive", "Sell"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: "Swap" })
    ).not.toBeInTheDocument()
  })

  it("hides Sell when the capability is off", () => {
    render(<WalletHeader canSell={false} onQuickAction={() => {}} />)
    expect(
      screen.queryByRole("button", { name: "Sell" })
    ).not.toBeInTheDocument()
  })

  it("fires onQuickAction with the action and a label", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletHeader canSell onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Send" }))
    expect(onQuickAction).toHaveBeenCalledWith("send", expect.any(String))
  })

  it("fires onQuickAction('sell', ...) when Sell is clicked", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletHeader canSell onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Sell" }))
    expect(onQuickAction).toHaveBeenCalledWith("sell", expect.any(String))
  })
})
