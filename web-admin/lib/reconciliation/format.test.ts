import { describe, expect, it } from "vitest"
import type { ReconBreak } from "@handshake-agent/contracts"

import {
  acceptDiff,
  deltaTone,
  engineEffect,
  engineLedger,
  formatDelta,
  formatRunTime,
} from "./format"

const OVER_CREDIT: ReconBreak = {
  id: "comp_1",
  kind: "over_credit",
  severity: "high",
  transactionId: "tx_9f2a41c7",
  asset: "USDT",
  delta: "+50.00",
  detail: "Ledger credited 50.00 USDT more than the provider confirmed.",
  status: "open",
  detectedAt: "2026-07-01T04:00:00.000Z",
}

describe("deltaTone", () => {
  it("is danger for over/duplicate credits, warn for mismatch, muted otherwise", () => {
    expect(deltaTone("over_credit")).toBe("text-tdn")
    expect(deltaTone("duplicate_credit")).toBe("text-tdn")
    expect(deltaTone("amount_mismatch")).toBe("text-twn")
    expect(deltaTone("missing_settlement")).toBe("text-ink2")
  })
})

describe("formatDelta", () => {
  it("preserves the sign and asset", () => {
    expect(formatDelta(OVER_CREDIT)).toBe("+50 USDT")
    expect(
      formatDelta({ ...OVER_CREDIT, asset: "NGN", delta: "-185000.00" })
    ).toBe("-₦185,000.00")
  })
})

describe("formatRunTime", () => {
  it("renders an em dash for null", () => {
    expect(formatRunTime(null)).toBe("—")
  })
  it("renders a HH:MM time for an ISO string", () => {
    expect(formatRunTime("2026-07-01T04:00:00.000Z")).toMatch(/\d{2}:\d{2}/)
  })
})

describe("engineEffect / engineLedger / acceptDiff", () => {
  it("itemizes the resolve effect from the break", () => {
    const effect = engineEffect(OVER_CREDIT)
    expect(effect[0]).toEqual({ k: "Transaction", v: "tx_9f2a41c7" })
    expect(effect[1]).toEqual({ k: "Break kind", v: "Over-credit" })
  })
  it("builds a balanced DR/CR preview stripped of the leading +", () => {
    const ledger = engineLedger(OVER_CREDIT)
    expect(ledger).toHaveLength(2)
    expect(ledger[0].dir).toBe("DR")
    expect(ledger[1].dir).toBe("CR")
    expect(ledger[0].amt).toBe(ledger[1].amt)
  })
  it("maps the accept disposition as an Open→Accepted change", () => {
    expect(acceptDiff(OVER_CREDIT)).toEqual([
      { field: "Break tx_9f2a41c7", from: "Open", to: "Accepted (no debit)" },
    ])
  })
})
