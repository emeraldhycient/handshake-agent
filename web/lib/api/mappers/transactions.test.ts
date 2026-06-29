import { describe, expect, it } from "vitest"
import { mapTransactions } from "./transactions"
import type { TransactionListResponse } from "@handshake-agent/contracts"

const now = new Date("2026-06-29T15:00:00.000Z")
const res: TransactionListResponse = {
  items: [
    {
      id: "a",
      type: "buy",
      status: "completed",
      asset: "USDT",
      cryptoAmount: "29.97",
      fiatAmount: "50000",
      fiatCurrency: "NGN",
      createdAt: "2026-06-29T13:14:00.000Z",
    },
    {
      id: "b",
      type: "send",
      status: "settling",
      asset: "USDT",
      cryptoAmount: "26.00",
      counterparty: "TQn9YgkXgk7r",
      createdAt: "2026-06-28T10:00:00.000Z",
    },
  ],
}

describe("mapTransactions", () => {
  it("groups by day and maps dir / title / amount / tone", () => {
    const groups = mapTransactions(res, now)
    expect(groups[0].group).toBe("Today")
    expect(groups[0].items[0]).toMatchObject({
      id: "a",
      dir: "in",
      title: "Bought USDT",
      amount: "+29.97 USDT",
      status: "Completed",
      statusTone: "success",
    })
    expect(groups[1].group).toBe("Yesterday")
    expect(groups[1].items[0]).toMatchObject({
      id: "b",
      dir: "out",
      amount: "-26.00 USDT",
      status: "Settling",
      statusTone: "warn",
    })
    // counterparty is truncated into the sub line
    expect(groups[1].items[0].sub).toContain("TQn9…gk7r")
  })

  it("returns an empty array for no items", () => {
    expect(mapTransactions({ items: [] }, now)).toEqual([])
  })
})
