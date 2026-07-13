import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { KycChoiceStep } from "./KycChoiceStep"

describe("KycChoiceStep", () => {
  it("greets the user by first name", () => {
    render(
      <KycChoiceStep
        firstName="Ada"
        onVerifyNow={vi.fn()}
        onVerifyLater={vi.fn()}
      />
    )
    expect(screen.getByText(/you're in, ada/i)).toBeInTheDocument()
  })

  it("falls back gracefully when firstName is missing", () => {
    render(<KycChoiceStep onVerifyNow={vi.fn()} onVerifyLater={vi.fn()} />)
    expect(screen.getByText(/you're in/i)).toBeInTheDocument()
  })

  it("calls onVerifyNow when the Verify now card is activated", async () => {
    const user = userEvent.setup()
    const onVerifyNow = vi.fn()
    render(
      <KycChoiceStep
        firstName="Ada"
        onVerifyNow={onVerifyNow}
        onVerifyLater={vi.fn()}
      />
    )
    await user.click(screen.getByRole("button", { name: /verify now/i }))
    expect(onVerifyNow).toHaveBeenCalledTimes(1)
  })

  it("calls onVerifyLater when the explore-first card is activated", async () => {
    const user = userEvent.setup()
    const onVerifyLater = vi.fn()
    render(
      <KycChoiceStep
        firstName="Ada"
        onVerifyNow={vi.fn()}
        onVerifyLater={onVerifyLater}
      />
    )
    await user.click(
      screen.getByRole("button", { name: /explore first, verify later/i })
    )
    expect(onVerifyLater).toHaveBeenCalledTimes(1)
  })
})
