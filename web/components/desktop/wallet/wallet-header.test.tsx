import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WalletHeader } from "./wallet-header"

describe("WalletHeader", () => {
  it("renders the Wallet title and all four actions when swap is on", () => {
    render(<WalletHeader canSwap onQuickAction={() => {}} />)
    expect(screen.getByRole("heading", { name: "Wallet" })).toBeInTheDocument()
    ;["Buy", "Send", "Receive", "Swap"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument()
    )
  })

  it("hides Swap when the capability is off", () => {
    render(<WalletHeader canSwap={false} onQuickAction={() => {}} />)
    expect(
      screen.queryByRole("button", { name: "Swap" })
    ).not.toBeInTheDocument()
  })

  it("fires onQuickAction with the action and a label", async () => {
    const onQuickAction = vi.fn()
    const user = userEvent.setup()
    render(<WalletHeader canSwap onQuickAction={onQuickAction} />)
    await user.click(screen.getByRole("button", { name: "Send" }))
    expect(onQuickAction).toHaveBeenCalledWith("send", expect.any(String))
  })
})
