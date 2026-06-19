import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ReceiptCard } from "./receipt-card"
import type { ReceiptCardProps } from "@/types/components"

const baseProps: ReceiptCardProps = {
  kind: "receipt",
  title: "Purchase confirmed",
  subtitle: "USDT sent to your wallet",
  amount: "₦50,120",
  rows: [
    { label: "You received", value: "32.5 USDT" },
    { label: "Network fee", value: "₦120" },
    { label: "Rate", value: "₦1,538/USDT" },
  ],
  ref: "TXN-20240614-8821",
  density: "mobile",
}

describe("ReceiptCard", () => {
  it("renders title for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Purchase confirmed")).toBeInTheDocument()
  })

  it("renders title for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Purchase confirmed")).toBeInTheDocument()
  })

  it("renders amount for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("₦50,120")).toBeInTheDocument()
  })

  it("renders amount for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("₦50,120")).toBeInTheDocument()
  })

  it("renders each detail row for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("You received")).toBeInTheDocument()
    expect(screen.getByText("32.5 USDT")).toBeInTheDocument()
    expect(screen.getByText("Network fee")).toBeInTheDocument()
  })

  it("renders each detail row for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("You received")).toBeInTheDocument()
    expect(screen.getByText("Rate")).toBeInTheDocument()
  })

  it("renders the transaction ref for mobile density", () => {
    render(<ReceiptCard {...baseProps} density="mobile" />)
    expect(screen.getByText("TXN-20240614-8821")).toBeInTheDocument()
  })

  it("renders the transaction ref for desktop density", () => {
    render(<ReceiptCard {...baseProps} density="desktop" />)
    expect(screen.getByText("TXN-20240614-8821")).toBeInTheDocument()
  })
})
