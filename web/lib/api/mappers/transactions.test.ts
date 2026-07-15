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

  it("maps an internal_transfer as an OUTGOING debit (sender-side row)", () => {
    // The sender's completed internal (PayID) transfer must read as money
    // LEAVING the wallet — `dir:"out"`, a leading "-", and the outflow icon —
    // never as an inflow with a green "+".
    const r: TransactionListResponse = {
      items: [
        {
          id: "it",
          type: "internal_transfer",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "3",
          createdAt: "2026-06-29T13:00:00.000Z",
        },
      ],
    }
    const item = mapTransactions(r, now)[0].items[0]
    expect(item.dir).toBe("out")
    expect(item.amount).toBe("-3 USDT")
    expect(item.icon).toBe("↗")
  })

  it("maps a recipient internal_transfer (direction:'in') as an INCOMING credit", () => {
    // The recipient-side row carries an explicit per-viewer direction:'in' — it
    // must read as money ARRIVING: dir:'in', a leading "+", the inflow icon, and
    // a "Received" title (never "Sent"), regardless of the type map.
    const r: TransactionListResponse = {
      items: [
        {
          id: "itr",
          type: "internal_transfer",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "3",
          direction: "in",
          counterparty: "@ada",
          createdAt: "2026-06-29T13:00:00.000Z",
        },
      ],
    }
    const item = mapTransactions(r, now)[0].items[0]
    expect(item.dir).toBe("in")
    expect(item.amount).toBe("+3 USDT")
    expect(item.icon).toBe("+")
    expect(item.title).toBe("Received USDT")
    // An inflow reads as arriving "from" the counterparty, not "to".
    expect(item.sub).toContain("from")
    expect(item.sub).not.toContain("to @")
  })

  it("maps a sender internal_transfer (direction:'out') as an OUTGOING debit titled 'Sent'", () => {
    const r: TransactionListResponse = {
      items: [
        {
          id: "its",
          type: "internal_transfer",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "3",
          direction: "out",
          createdAt: "2026-06-29T13:00:00.000Z",
        },
      ],
    }
    const item = mapTransactions(r, now)[0].items[0]
    expect(item.dir).toBe("out")
    expect(item.amount).toBe("-3 USDT")
    expect(item.title).toBe("Sent USDT")
  })

  it("formats fiat amounts with the provided symbol map (no hardcoded NGN)", () => {
    const r: TransactionListResponse = {
      items: [
        {
          id: "g",
          type: "buy",
          status: "completed",
          fiatAmount: "1000",
          fiatCurrency: "GHS",
          createdAt: "2026-06-29T13:00:00.000Z",
        },
      ],
    }
    const groups = mapTransactions(r, now, { GHS: "GH₵" })
    expect(groups[0].items[0].amount).toBe("+GH₵1,000")
  })

  describe("status tone (#24 — distinct failure state)", () => {
    function toneOf(status: string): string {
      const r: TransactionListResponse = {
        items: [
          {
            id: "x",
            type: "send",
            status,
            asset: "USDT",
            cryptoAmount: "1",
            createdAt: "2026-06-29T13:00:00.000Z",
          },
        ],
      }
      return mapTransactions(r, now)[0].items[0].statusTone
    }

    it("completed → success", () => {
      expect(toneOf("completed")).toBe("success")
    })

    it("pending → warn (still in flight)", () => {
      expect(toneOf("pending")).toBe("warn")
    })

    it("settling → warn (still in flight)", () => {
      expect(toneOf("settling")).toBe("warn")
    })

    it("failed → danger (distinct from in-flight)", () => {
      expect(toneOf("failed")).toBe("danger")
    })

    it("refunded → danger (terminal reversal)", () => {
      expect(toneOf("refunded")).toBe("danger")
    })

    it("reversed → danger (terminal reversal)", () => {
      expect(toneOf("reversed")).toBe("danger")
    })

    it("a failed tx does NOT share the pending 'warn' tone", () => {
      expect(toneOf("failed")).not.toBe(toneOf("pending"))
    })
  })
})
