import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

const useConfig = vi.hoisted(() => vi.fn())
vi.mock("@/lib/query/hooks", () => ({ useConfig: () => useConfig() }))

import { DoneStep } from "./DoneStep"

describe("DoneStep", () => {
  beforeEach(() => {
    push.mockClear()
    useConfig.mockReturnValue({
      data: {
        fiats: [
          { code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 },
        ],
      },
    })
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

  it("renders Open my wallet as the amber accent CTA", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(
      screen.getByRole("button", { name: /open my wallet/i })
    ).toHaveAttribute("data-variant", "accent")
  })

  it("keeps the banner's Verify now CTA on the dark treatment, not amber (matches the mockup: this button is bg #15241d / white text, unlike every other primary CTA)", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="unverified"
        skipped
        onVerifyNow={vi.fn()}
      />
    )
    expect(
      screen.getByRole("button", { name: /verify now/i })
    ).not.toHaveAttribute("data-variant", "accent")
  })

  it("renders the CONFIG default fiat, not a hardcoded Naira/₦, when the first enabled fiat is non-default", () => {
    useConfig.mockReturnValue({
      data: {
        fiats: [
          { code: "USD", displayName: "US Dollar", symbol: "$", decimals: 2 },
        ],
      },
    })
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/us dollar balance/i)).toBeInTheDocument()
    expect(screen.getByText("$0.00")).toBeInTheDocument()
    expect(screen.queryByText(/naira balance/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/₦/)).not.toBeInTheDocument()
  })

  it("the agent hint is an amount-free open prompt, not the hardcoded 'Buy ₦50,000 of USDT' demo label", () => {
    render(
      <DoneStep
        firstName="Ada"
        kycStatus="verified"
        skipped={false}
        onVerifyNow={vi.fn()}
      />
    )
    expect(screen.getByText(/i'd like to buy usdt/i)).toBeInTheDocument()
    expect(screen.queryByText(/₦50,000/)).not.toBeInTheDocument()
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
