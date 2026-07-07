import { describe, expect, it } from "vitest"
import type { AdminTxnDetail } from "@handshake-agent/contracts"

import { ApiError } from "@/lib/api/client"
import {
  flowSpecFor,
  headerTitle,
  providerRefs,
  timelineTone,
  txActionError,
} from "./tx-detail"

const TX = {
  id: "tx-1",
  userId: "user-1",
  type: "buy",
  economics: { amount: "50", asset: "USDT" },
  idempotencyKey: "idem-1",
  ledgerLegs: [
    {
      accountType: "user_wallet",
      accountId: "acc-1",
      currency: "USDT",
      direction: "debit",
      amount: "50",
      sequence: 1,
    },
  ],
  providerReferences: [
    { provider: "tron", reference: "0xhash" },
    { provider: "acme", reference: "ref-9" },
  ],
} as unknown as AdminTxnDetail

describe("headerTitle", () => {
  it("uses type · amount asset when economics carry an amount + asset", () => {
    expect(headerTitle(TX)).toBe("buy · 50 USDT")
  })
  it("falls back to type · amount, then just type", () => {
    expect(
      headerTitle({ ...TX, economics: { amount: "50", asset: "" } } as AdminTxnDetail)
    ).toBe("buy · 50")
    expect(
      headerTitle({ ...TX, economics: { amount: "", asset: "" } } as AdminTxnDetail)
    ).toBe("buy")
  })
})

describe("timelineTone", () => {
  it("maps terminal-bad → fail, terminal-good → done, else pending", () => {
    for (const s of ["failed", "cancelled", "rolled_back"])
      expect(timelineTone(s)).toBe("fail")
    for (const s of ["completed", "confirmed"]) expect(timelineTone(s)).toBe("done")
    for (const s of ["pending", "settling", "validating"])
      expect(timelineTone(s)).toBe("pending")
  })
})

describe("flowSpecFor", () => {
  it("retry: engine-only, no ledger legs written", () => {
    const spec = flowSpecFor("retry", TX)
    expect(spec?.steps).toEqual(["engine"])
    expect(spec?.ledger).toEqual([])
  })
  it("refund: reason → maker (four-eyes), with a from→to diff + the tx ledger", () => {
    const spec = flowSpecFor("refund", TX)
    expect(spec?.steps).toEqual(["reason", "maker"])
    expect(spec?.diff?.[0].to).toBe("Failed + refunded")
    expect(spec?.ledger).toHaveLength(1)
    expect(spec?.ledger[0].dir).toBe("DR")
  })
  it("markFailed: reason → engine", () => {
    expect(flowSpecFor("markFailed", TX)?.steps).toEqual(["reason", "engine"])
  })
  it("recon: engine-only, read-only (no ledger legs)", () => {
    const spec = flowSpecFor("recon", TX)
    expect(spec?.steps).toEqual(["engine"])
    expect(spec?.ledger).toEqual([])
  })
  it("receipt: no flow (null)", () => {
    expect(flowSpecFor("receipt", TX)).toBeNull()
  })
})

describe("providerRefs", () => {
  it("maps known providers with explorer links, title-cases unknowns, appends idempotency", () => {
    const refs = providerRefs(TX)
    expect(refs[0]).toEqual({
      label: "TRON",
      value: "0xhash",
      link: "Tronscan",
      href: "https://tronscan.org/#/transaction/0xhash",
    })
    expect(refs[1]).toEqual({ label: "Acme", value: "ref-9" })
    expect(refs[refs.length - 1]).toEqual({
      label: "Idempotency",
      value: "idem-1",
    })
  })
})

describe("txActionError", () => {
  it("prefers ApiError/Error messages, falls back for opaque values", () => {
    expect(txActionError(new ApiError("nope", 500, "X"))).toBe("nope")
    expect(txActionError(new Error("boom"))).toBe("boom")
    expect(txActionError(null)).toBe("The action could not be completed.")
  })
})
