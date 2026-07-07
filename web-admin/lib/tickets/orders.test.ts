import { describe, expect, it } from "vitest"
import type { TicketOrderItem } from "@handshake-agent/contracts"

import { formatNgn, orderPillStatus } from "./orders"

function order(
  over: Partial<TicketOrderItem> & Pick<TicketOrderItem, "id">
): TicketOrderItem {
  return {
    userId: "u-1",
    vendorKey: "eventbrite",
    ticketType: "GA",
    quantity: 1,
    totalAmount: "45000.00",
    paymentStatus: "paid",
    settlementStatus: "settled",
    deliveryStatus: "delivered",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }
}

describe("formatNgn", () => {
  it("formats a canonical NGN decimal string with 2 dp", () => {
    expect(formatNgn("45000.00")).toBe("₦45,000.00")
    expect(formatNgn("1234.5")).toBe("₦1,234.50")
  })
  it("returns the raw input for a non-numeric value", () => {
    expect(formatNgn("n/a")).toBe("n/a")
  })
})

describe("orderPillStatus", () => {
  it("maps known settlement statuses", () => {
    expect(
      orderPillStatus(order({ id: "1", settlementStatus: "settled" }))
    ).toBe("settled")
    expect(
      orderPillStatus(order({ id: "2", settlementStatus: "pending" }))
    ).toBe("pending_settlement")
    expect(
      orderPillStatus(order({ id: "3", settlementStatus: "refunded" }))
    ).toBe("refunded")
    expect(
      orderPillStatus(order({ id: "4", settlementStatus: "failed" }))
    ).toBe("failed")
  })
  it("folds an unknown status onto a neutral in-flight pill", () => {
    expect(orderPillStatus(order({ id: "5", settlementStatus: "weird" }))).toBe(
      "pending_settlement"
    )
  })
})
