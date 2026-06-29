import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { PayInCard } from "./pay-in-card"
import type { PayInCardProps } from "@/types/components"

const baseProps: PayInCardProps = {
  kind: "pay_in",
  transactionId: "txn-123",
  accountNumber: "1234567890",
  bankName: "Mock Bank",
  providerRef: "MOCK-FLW-abc",
  amount: "20000",
  currency: "NGN",
  status: "settling",
  density: "mobile",
}

describe("PayInCard", () => {
  it("renders the amount with the ₦ symbol, thousands separators, and 2dp", () => {
    render(<PayInCard {...baseProps} amount="20000" currency="NGN" />)

    expect(screen.getByText("₦20,000.00")).toBeInTheDocument()
  })

  it("does not render the raw, unformatted '<currency> <amount>' form", () => {
    render(<PayInCard {...baseProps} amount="20000" currency="NGN" />)

    expect(screen.queryByText("NGN 20000")).not.toBeInTheDocument()
  })
})
