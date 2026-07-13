import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { WelcomeStep } from "./WelcomeStep"

describe("WelcomeStep", () => {
  it("renders the welcome headline and a log-in link to /login", () => {
    render(<WelcomeStep onNext={vi.fn()} />)

    expect(
      screen.getByRole("heading", { name: /set up your wallet/i })
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute(
      "href",
      "/login"
    )
  })

  it("calls onNext when Get started is clicked", async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<WelcomeStep onNext={onNext} />)

    await user.click(screen.getByRole("button", { name: /get started/i }))

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("renders full-bleed on the mobile dark-green brand gradient", () => {
    render(<WelcomeStep onNext={vi.fn()} />)

    expect(screen.getByTestId("welcome-mobile-shell")).toHaveClass(
      "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]"
    )
  })
})
