import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { QuoteCard } from "./quote-card"
import type { QuoteCardProps } from "@/types/components"

const baseProps: QuoteCardProps = {
  kind: "quote",
  action: "buy",
  receiveAmt: "₦50,000",
  receiveSub: "≈ 32.5 USDT at ₦1,538/USDT",
  rows: [
    { label: "You pay", value: "₦50,000" },
    { label: "Network fee", value: "₦120" },
    { label: "Rate", value: "₦1,538/USDT" },
  ],
  totalLabel: "Total cost",
  totalValue: "₦50,120",
  lockSeconds: 58,
  density: "mobile",
  onConfirm: vi.fn(),
}

describe("QuoteCard", () => {
  it("renders lock badge with lockSeconds=58 formatted as '0:58'", () => {
    render(<QuoteCard {...baseProps} lockSeconds={58} />)
    expect(screen.getByText("Locked 0:58")).toBeInTheDocument()
  })

  it("renders lock badge with lockSeconds=60 formatted as '1:00'", () => {
    render(<QuoteCard {...baseProps} lockSeconds={60} />)
    expect(screen.getByText("Locked 1:00")).toBeInTheDocument()
  })

  it("renders receiveAmt and receiveSub for mobile density", () => {
    render(<QuoteCard {...baseProps} density="mobile" />)
    // getAllByText because ₦50,000 also appears in the detail rows
    expect(screen.getAllByText("₦50,000").length).toBeGreaterThan(0)
    expect(screen.getByText("≈ 32.5 USDT at ₦1,538/USDT")).toBeInTheDocument()
  })

  it("renders receiveAmt and receiveSub for desktop density", () => {
    render(<QuoteCard {...baseProps} density="desktop" />)
    expect(screen.getAllByText("₦50,000").length).toBeGreaterThan(0)
    expect(screen.getByText("≈ 32.5 USDT at ₦1,538/USDT")).toBeInTheDocument()
  })

  it("renders a row label for both densities", () => {
    const { rerender } = render(<QuoteCard {...baseProps} density="mobile" />)
    expect(screen.getByText("You pay")).toBeInTheDocument()

    rerender(<QuoteCard {...baseProps} density="desktop" />)
    expect(screen.getByText("You pay")).toBeInTheDocument()
  })

  it("renders totalLabel for both densities", () => {
    const { rerender } = render(<QuoteCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Total cost")).toBeInTheDocument()

    rerender(<QuoteCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Total cost")).toBeInTheDocument()
  })

  it("calls onConfirm when the Review & confirm button is clicked (mobile)", async () => {
    const onConfirm = vi.fn()
    render(<QuoteCard {...baseProps} density="mobile" onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it("calls onConfirm when the Review & confirm button is clicked (desktop)", async () => {
    const onConfirm = vi.fn()
    render(<QuoteCard {...baseProps} density="desktop" onConfirm={onConfirm} />)
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i })
    )
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})

describe("QuoteCard — reassurance/expiry footer (finding: desktop drops it)", () => {
  it("renders the 'No hidden fees' reassurance on desktop, not just mobile", () => {
    render(<QuoteCard {...baseProps} density="desktop" lockSeconds={58} />)
    expect(screen.getByText(/no hidden fees/i)).toBeInTheDocument()
  })

  it("renders the expiry-recovery hint on desktop when the quote is expired", () => {
    render(<QuoteCard {...baseProps} density="desktop" lockSeconds={0} />)
    expect(
      screen.getByText("Request a new quote to continue")
    ).toBeInTheDocument()
  })

  it("still renders the reassurance footer on mobile", () => {
    render(<QuoteCard {...baseProps} density="mobile" lockSeconds={58} />)
    expect(screen.getByText(/no hidden fees/i)).toBeInTheDocument()
  })
})

describe("QuoteCard — terminal proposal state on reload (Bug 2)", () => {
  it("renders a disabled 'Completed' CTA (not 'Review & confirm') for an executed proposal", () => {
    render(
      <QuoteCard {...baseProps} lockSeconds={58} proposalStatus="executed" />
    )
    // The active confirm affordance is gone.
    expect(
      screen.queryByRole("button", { name: /review & confirm/i })
    ).not.toBeInTheDocument()
    const cta = screen.getByRole("button", { name: /completed/i })
    expect(cta).toBeDisabled()
  })

  it("does not call onConfirm when an executed card's CTA is clicked", async () => {
    const onConfirm = vi.fn()
    render(
      <QuoteCard
        {...baseProps}
        lockSeconds={58}
        proposalStatus="executed"
        onConfirm={onConfirm}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: /completed/i }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("renders a 'Cancelled' terminal state for a rejected proposal", () => {
    render(
      <QuoteCard {...baseProps} lockSeconds={58} proposalStatus="rejected" />
    )
    expect(screen.getByRole("button", { name: /cancelled/i })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: /review & confirm/i })
    ).not.toBeInTheDocument()
  })

  it("keeps the live active CTA for a still-pending proposal (unchanged behaviour)", () => {
    render(
      <QuoteCard {...baseProps} lockSeconds={58} proposalStatus="pending" />
    )
    expect(
      screen.getByRole("button", { name: /review & confirm/i })
    ).toBeEnabled()
  })
})
