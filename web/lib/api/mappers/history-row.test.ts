import { describe, expect, it } from "vitest"
import { mapHistoryItemToRow } from "./history-row"
import type { TransactionHistoryItem } from "@handshake-agent/contracts"

const item = (
  over: Partial<TransactionHistoryItem>
): TransactionHistoryItem => ({
  id: "t1",
  type: "buy",
  status: "completed",
  direction: "in",
  createdAt: "2026-06-10T10:00:00.000Z",
  ...over,
})

describe("mapHistoryItemToRow", () => {
  it("signs an inflow with + and uses the formatted crypto amount", () => {
    const row = mapHistoryItemToRow(item({ cryptoAmount: "29.97 USDT" }))
    expect(row).toEqual({
      id: "t1",
      type: "buy",
      status: "completed",
      direction: "in",
      amount: "+29.97 USDT",
      sub: "2026-06-10",
    })
  })

  it("signs an outflow with -", () => {
    const row = mapHistoryItemToRow(
      item({ direction: "out", type: "send", cryptoAmount: "10 USDT" })
    )
    expect(row.amount).toBe("-10 USDT")
    expect(row.direction).toBe("out")
  })

  it("falls back to the fiat amount when there is no crypto amount", () => {
    const row = mapHistoryItemToRow(
      item({ fiatAmount: "₦50,000", cryptoAmount: undefined })
    )
    expect(row.amount).toBe("+₦50,000")
  })
})
