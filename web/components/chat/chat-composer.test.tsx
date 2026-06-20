import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ChatComposer } from "./chat-composer"
import type { ChatAction } from "@/lib/schemas"

describe("ChatComposer", () => {
  const chips: ChatAction[] = ["buy", "balance"]
  const defaultProps = {
    chips,
    value: "",
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onChip: vi.fn(),
    density: "mobile" as const,
  }

  it("renders a chip for each action with its label", () => {
    render(<ChatComposer {...defaultProps} />)
    // chipLabel("buy") === "Buy ₦50,000 of USDT"
    expect(
      screen.getByRole("button", { name: /buy ₦50,000 of usdt/i })
    ).toBeInTheDocument()
    // chipLabel("balance") is something like "Check my balance"
    expect(screen.getByRole("button", { name: /balance/i })).toBeInTheDocument()
  })

  it("clicking a chip calls onChip with the action", async () => {
    const onChip = vi.fn()
    render(<ChatComposer {...defaultProps} onChip={onChip} />)
    await userEvent.click(
      screen.getByRole("button", { name: /buy ₦50,000 of usdt/i })
    )
    expect(onChip).toHaveBeenCalledWith("buy")
  })

  it("typing in the input fires onChange", async () => {
    const onChange = vi.fn()
    render(<ChatComposer {...defaultProps} onChange={onChange} />)
    const input = screen.getByPlaceholderText(/message handshake agent/i)
    await userEvent.type(input, "h")
    expect(onChange).toHaveBeenCalled()
  })

  it("pressing Enter calls onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...defaultProps} onSubmit={onSubmit} />)
    const input = screen.getByPlaceholderText(/message handshake agent/i)
    await userEvent.type(input, "{Enter}")
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("clicking the send button calls onSubmit", async () => {
    const onSubmit = vi.fn()
    render(<ChatComposer {...defaultProps} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole("button", { name: /send/i }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})
