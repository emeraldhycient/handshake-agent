import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

import { DoneStep } from "./DoneStep"

describe("DoneStep", () => {
  beforeEach(() => {
    push.mockClear()
  })

  it("welcomes the user by first name and shows a zero balance", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/welcome to handshake, ada/i)).toBeInTheDocument()
    expect(screen.getByText(/₦0\.00/)).toBeInTheDocument()
  })

  it("shows a Verified badge and no banner when fully verified", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/^verified$/i)).toBeInTheDocument()
    expect(screen.queryByText(/verify to unlock/i)).not.toBeInTheDocument()
  })

  it("shows an Unverified badge and the verify banner when skipped", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="unverified"
        skipped
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/^unverified$/i)).toBeInTheDocument()
    // Mobile ("Verify to unlock everything") and desktop ("Verify to unlock
    // sending & cash-out") copy both render (the `lg:` breakpoint that picks
    // between them isn't evaluated in jsdom) — assert at least one is present
    // rather than pinning to a single element.
    expect(screen.getAllByText(/verify to unlock/i).length).toBeGreaterThan(0)
  })

  it("renders the mobile dark-green header band on the brand gradient", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByTestId("done-header-band")).toHaveClass(
      "bg-[linear-gradient(168deg,var(--primary)_0%,var(--primary-deep)_100%)]"
    )
  })

  it("calls onVerifyNow from the banner CTA", async () => {
    const user = userEvent.setup()
    const onVerifyNow = vi.fn()
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="unverified"
        skipped
        onVerifyNow={onVerifyNow}
      />
    )
    await user.click(screen.getByRole("button", { name: /verify now/i }))
    expect(onVerifyNow).toHaveBeenCalledTimes(1)
  })

  it("routes to / when Open my wallet is clicked", async () => {
    const user = userEvent.setup()
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    await user.click(screen.getByRole("button", { name: /open my wallet/i }))
    expect(push).toHaveBeenCalledWith("/")
  })

  it("shows an In review badge while KYC is pending", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="pending_review"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/in review/i)).toBeInTheDocument()
  })
})
