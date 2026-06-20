import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { MobileTabbar } from "./mobile-tabbar"

describe("MobileTabbar", () => {
  it("renders three tab buttons with accessible names", () => {
    render(<MobileTabbar active="chat" onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /chat/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /wallet/i })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /activity/i })
    ).toBeInTheDocument()
  })

  it("calls onSelect('wallet') when Wallet is tapped", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MobileTabbar active="chat" onSelect={onSelect} />)
    await user.click(screen.getByRole("button", { name: /wallet/i }))
    expect(onSelect).toHaveBeenCalledWith("wallet")
  })

  it("calls onSelect('activity') when Activity is tapped", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MobileTabbar active="chat" onSelect={onSelect} />)
    await user.click(screen.getByRole("button", { name: /activity/i }))
    expect(onSelect).toHaveBeenCalledWith("activity")
  })

  it("calls onSelect('chat') when Chat is tapped", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<MobileTabbar active="wallet" onSelect={onSelect} />)
    await user.click(screen.getByRole("button", { name: /chat/i }))
    expect(onSelect).toHaveBeenCalledWith("chat")
  })

  it("active tab has aria-current='page'", () => {
    render(<MobileTabbar active="wallet" onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /wallet/i })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("inactive tabs do not have aria-current='page'", () => {
    render(<MobileTabbar active="wallet" onSelect={() => {}} />)
    expect(screen.getByRole("button", { name: /chat/i })).not.toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(
      screen.getByRole("button", { name: /activity/i })
    ).not.toHaveAttribute("aria-current", "page")
  })
})
