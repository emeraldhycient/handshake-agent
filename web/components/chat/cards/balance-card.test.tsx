import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { BalanceCard } from "./balance-card"
import type { BalanceCardProps } from "@/types/components"

const baseProps: BalanceCardProps = {
  kind: "balance",
  total: "≈ ₦72,340",
  assets: [
    {
      sym: "USDT",
      name: "Tether USD",
      amount: "32.5 USDT",
      value: "₦49,985",
      tint: "#7fd1a8",
    },
    {
      sym: "BTC",
      name: "Bitcoin",
      amount: "0.00041 BTC",
      value: "₦18,200",
      tint: "#f5c46b",
    },
    {
      sym: "ETH",
      name: "Ethereum",
      amount: "0.009 ETH",
      value: "₦4,155",
      tint: "#cfe6d8",
    },
  ],
  density: "mobile",
}

describe("BalanceCard", () => {
  it("renders total balance for mobile density", () => {
    render(<BalanceCard {...baseProps} density="mobile" />)
    expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument()
  })

  it("renders total balance for desktop density", () => {
    render(<BalanceCard {...baseProps} density="desktop" />)
    expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument()
  })

  it("renders each asset name for mobile density", () => {
    render(<BalanceCard {...baseProps} density="mobile" />)
    expect(screen.getByText("Tether USD")).toBeInTheDocument()
    expect(screen.getByText("Bitcoin")).toBeInTheDocument()
    expect(screen.getByText("Ethereum")).toBeInTheDocument()
  })

  it("renders each asset value for mobile density", () => {
    render(<BalanceCard {...baseProps} density="mobile" />)
    expect(screen.getByText("₦49,985")).toBeInTheDocument()
    expect(screen.getByText("₦18,200")).toBeInTheDocument()
    expect(screen.getByText("₦4,155")).toBeInTheDocument()
  })

  it("renders each asset name for desktop density", () => {
    render(<BalanceCard {...baseProps} density="desktop" />)
    expect(screen.getByText("Tether USD")).toBeInTheDocument()
    expect(screen.getByText("Bitcoin")).toBeInTheDocument()
  })

  it("renders each asset value for desktop density", () => {
    render(<BalanceCard {...baseProps} density="desktop" />)
    expect(screen.getByText("₦49,985")).toBeInTheDocument()
    expect(screen.getByText("₦18,200")).toBeInTheDocument()
  })
})
