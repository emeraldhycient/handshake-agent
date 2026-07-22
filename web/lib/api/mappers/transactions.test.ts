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

  describe("counterparty truncation", () => {
    function subOf(counterparty: string): string {
      const r: TransactionListResponse = {
        items: [
          {
            id: "x",
            type: "internal_transfer",
            status: "completed",
            asset: "USDT",
            cryptoAmount: "1",
            direction: "out",
            counterparty,
            createdAt: "2026-06-29T13:00:00.000Z",
          },
        ],
      }
      return mapTransactions(r, now)[0].items[0].sub
    }

    // A PayID handle is 3–30 chars (`PayIdSchema`) and reaches this mapper with
    // an "@" prefix, so a counterparty as short as "@ada" is routine. Truncating
    // one is not just pointless, it corrupts it: unguarded head/tail slices of a
    // short string OVERLAP and render the handle doubled.
    it("leaves a short PayID handle intact instead of doubling it", () => {
      // Anchored: `toContain("to @ada")` would also pass on the doubled
      // "to @ada…@ada", so it would prove nothing.
      expect(subOf("@ada")).toMatch(/· to @ada$/)
    })

    it("leaves every counterparty short enough to fit unabbreviated", () => {
      // 9 chars is the last width where head(4)+…+tail(4) cannot shorten it.
      expect(subOf("@tobi1234")).toContain("to @tobi1234")
      expect(subOf("@tobi1234")).not.toContain("…")
    })

    it("starts abbreviating at the first width that actually shortens", () => {
      // 10 chars — one past the guard, so the ellipsis form is a real saving.
      expect(subOf("@tobi12345")).toContain("to @tob…2345")
    })

    // The 4/4 masked width for real addresses is deliberate — pin it so the
    // guard above can never be "fixed" by widening what long addresses show.
    it("keeps the 4/4 masked width for a long chain address", () => {
      expect(subOf("TQn9YgkXgk7rABCDEF")).toContain("to TQn9…CDEF")
    })
  })

  // `titleCase` itself is covered in lib/transaction/format.test.ts; what this
  // pins is the mapper's WIRING to it. Every other status fixture here is a
  // single word, so dropping the call entirely would still pass them —
  // `rolled_back` is the shape that makes the call observable.
  it("title-cases a snake_case status for display", () => {
    const r: TransactionListResponse = {
      items: [
        {
          id: "rb",
          type: "send",
          status: "rolled_back",
          asset: "USDT",
          cryptoAmount: "1",
          createdAt: "2026-06-29T13:00:00.000Z",
        },
      ],
    }
    const item = mapTransactions(r, now)[0].items[0]
    expect(item.status).toBe("Rolled back")
    // Pinned deliberately, NOT endorsed: this mapper's FAILURE_STATUSES
    // ("failed"/"refunded"/"reversed") disagrees with `lib/transaction/format`
    // `toneFor` ("failed"/"rolled_back"), which the detail modal uses — so the
    // same rolled-back transaction reads amber "in flight" in this list and
    // red in its own modal. Reconciling them is a display decision, not a
    // rename; this assertion makes whichever way it is decided fail loudly here.
    expect(item.statusTone).toBe("warn")
  })
})
