import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { TransactionStatusResponse } from "@handshake-agent/contracts"
import type { PayInCardProps } from "@/types/components"

// C4: PayInCardLive is the SINGLE settlement watcher. We mock the polling hook
// and the store action so we can assert the wiring without a live query client.
const mockUseTransactionStatus = vi.fn()
const mockResolveSettlement = vi.fn()

vi.mock("@/lib/query/hooks", () => ({
  useTransactionStatus: (
    transactionId: string | null,
    options?: { enabled?: boolean }
  ) => mockUseTransactionStatus(transactionId, options),
}))

vi.mock("@/lib/store/chat-store", () => ({
  useChatStore: (
    selector: (s: {
      resolveSettlement: typeof mockResolveSettlement
    }) => unknown
  ) => selector({ resolveSettlement: mockResolveSettlement }),
}))

import { PayInCard, PayInCardLive } from "./pay-in-card"

const TX_ID = "tttttttt-tttt-tttt-tttt-tttttttttttt"

const baseProps: PayInCardProps = {
  kind: "pay_in",
  transactionId: TX_ID,
  accountNumber: "0123456789",
  bankName: "Test Bank",
  providerRef: "REF001",
  amount: "50250",
  currency: "NGN",
  status: "settling",
  density: "mobile",
}

function tx(
  status: TransactionStatusResponse["status"]
): TransactionStatusResponse {
  return {
    id: TX_ID,
    type: "buy",
    status,
    createdAt: "2026-06-29T00:00:00.000Z",
  }
}

describe("PayInCardLive (C4: single settlement watcher)", () => {
  beforeEach(() => {
    mockUseTransactionStatus.mockReset()
    mockResolveSettlement.mockReset()
  })

  it("surfaces a FAILED settlement: renders 'Payment failed' and notifies the store (no swallowed failure)", () => {
    mockUseTransactionStatus.mockReturnValue({ data: tx("failed") })

    render(<PayInCardLive {...baseProps} />)

    expect(screen.getByText("Payment failed")).toBeInTheDocument()
    expect(mockResolveSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: TX_ID, status: "failed" })
    )
  })

  it("on COMPLETED: notifies the store exactly once (the hook is the only watcher)", () => {
    mockUseTransactionStatus.mockReturnValue({ data: tx("completed") })

    render(<PayInCardLive {...baseProps} />)

    expect(mockResolveSettlement).toHaveBeenCalledTimes(1)
    expect(mockResolveSettlement).toHaveBeenCalledWith(
      expect.objectContaining({ id: TX_ID, status: "completed" })
    )
  })

  it("while still SETTLING: does not resolve (no premature receipt/failure)", () => {
    mockUseTransactionStatus.mockReturnValue({ data: tx("settling") })

    render(<PayInCardLive {...baseProps} />)

    expect(mockResolveSettlement).not.toHaveBeenCalled()
  })

  it("a card that mounts already terminal disables polling (enabled:false) — no infinite poll", () => {
    mockUseTransactionStatus.mockReturnValue({ data: tx("completed") })

    render(<PayInCardLive {...baseProps} status="completed" />)

    expect(mockUseTransactionStatus).toHaveBeenCalledWith(
      TX_ID,
      expect.objectContaining({ enabled: false })
    )
  })
})

describe("PayInCard", () => {
  it("renders the NGN amount with the ₦ symbol, thousands separators, and 2dp", () => {
    render(<PayInCard {...baseProps} amount="20000" currency="NGN" />)

    expect(screen.getByText("₦20,000.00")).toBeInTheDocument()
  })

  it("does not render the raw, unformatted '<currency> <amount>' form", () => {
    render(<PayInCard {...baseProps} amount="20000" currency="NGN" />)

    expect(screen.queryByText("NGN 20000")).not.toBeInTheDocument()
  })

  it("drives the symbol from the payment currency — GHS renders GH₵, never ₦ (audit #18)", () => {
    render(<PayInCard {...baseProps} amount="20000" currency="GHS" />)

    expect(screen.getByText("GH₵20,000.00")).toBeInTheDocument()
    expect(screen.queryByText(/₦20,000\.00$/)).not.toBeInTheDocument()
  })

  it("KES renders KSh, not the hardcoded naira symbol", () => {
    render(<PayInCard {...baseProps} amount="1500" currency="KES" />)

    expect(screen.getByText("KSh1,500.00")).toBeInTheDocument()
  })

  it("falls back to the currency code for an unknown symbol (still not ₦)", () => {
    render(<PayInCard {...baseProps} amount="1000" currency="XOF" />)

    // No hardcoded ₦; the code prefixes the amount when no symbol is known.
    expect(screen.getByText("XOF 1,000.00")).toBeInTheDocument()
    expect(screen.queryByText("₦1,000.00")).not.toBeInTheDocument()
  })
})
