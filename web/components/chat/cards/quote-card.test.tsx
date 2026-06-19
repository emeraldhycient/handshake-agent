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
