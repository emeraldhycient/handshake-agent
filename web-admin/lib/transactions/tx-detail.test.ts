import { describe, expect, it } from "vitest"
import type {
  AdminTxnDetail,
  AdminTxnEconomics,
} from "@handshake-agent/contracts"

import { ApiError } from "@/lib/api/client"
import {
  economicsRows,
  flowSpecFor,
  formatWhen,
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
    {
      accountType: "clearing",
      accountId: "acc-2",
      currency: "USDT",
      direction: "credit",
      amount: "50",
      sequence: 2,
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
  it("falls back to type · amount, then just type (incl. asset-only)", () => {
    expect(
      headerTitle({ ...TX, economics: { amount: "50", asset: "" } } as AdminTxnDetail)
    ).toBe("buy · 50")
    expect(
      headerTitle({ ...TX, economics: { amount: "", asset: "" } } as AdminTxnDetail)
    ).toBe("buy")
    // asset present but no amount → neither guard fires → just the type.
    expect(
      headerTitle({ ...TX, economics: { amount: "", asset: "USDT" } } as AdminTxnDetail)
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
  it("retry: engine-only, no ledger legs written, settlement.retry directive", () => {
    const spec = flowSpecFor("retry", TX)
    expect(spec?.steps).toEqual(["engine"])
    expect(spec?.ledger).toEqual([])
    expect(spec?.effect).toContainEqual({ k: "Directive", v: "settlement.retry" })
  })
  it("refund: reason → maker (four-eyes), diff + the exact itemized tx ledger", () => {
    const spec = flowSpecFor("refund", TX)
    expect(spec?.steps).toEqual(["reason", "maker"])
    expect(spec?.diff?.[0].to).toBe("Failed + refunded")
    // Both directions + the money-bearing acct/amt (catches a formatAmount arg-swap).
    expect(spec?.ledger).toEqual([
      { acct: "user_wallet:acc-1:USDT", dir: "DR", amt: "50 USDT" },
      { acct: "clearing:acc-2:USDT", dir: "CR", amt: "50 USDT" },
    ])
  })
  it("markFailed: reason → engine, carrying the same itemized tx ledger", () => {
    const spec = flowSpecFor("markFailed", TX)
    expect(spec?.steps).toEqual(["reason", "engine"])
    // markFailed itemizes the money legs it will reverse — not empty.
    expect(spec?.ledger).toHaveLength(2)
    expect(spec?.ledger.map((l) => l.dir)).toEqual(["DR", "CR"])
    // The engine directive the approver reads must be mark_failed, not the retry one.
    expect(spec?.effect).toContainEqual({ k: "Directive", v: "mark_failed" })
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

  it("labels a configured no-explorer provider (Flutterwave) without a link", () => {
    const refs = providerRefs({
      ...TX,
      providerReferences: [{ provider: "flutterwave", reference: "flw-1" }],
    } as AdminTxnDetail)
    expect(refs[0]).toEqual({ label: "Flutterwave", value: "flw-1" })
  })

  it("still surfaces the idempotency row when there are no provider references", () => {
    const refs = providerRefs({
      ...TX,
      providerReferences: [],
    } as AdminTxnDetail)
    expect(refs).toEqual([{ label: "Idempotency", value: "idem-1" }])
  })
})

describe("formatWhen", () => {
  it("renders a non-empty string for an ISO timestamp (no throw)", () => {
    expect(formatWhen("2026-07-04T00:00:00.000Z")).not.toBe("")
  })
})

describe("txActionError", () => {
  it("prefers ApiError/Error messages, falls back for opaque values", () => {
    expect(txActionError(new ApiError("nope", 500, "X"))).toBe("nope")
    expect(txActionError(new Error("boom"))).toBe("boom")
    expect(txActionError(null)).toBe("The action could not be completed.")
  })
})

describe("economicsRows", () => {
  const ECON = {
    amount: "50",
    asset: "USDT",
    fiatCurrency: "NGN",
    fiatAmount: "75000",
    fxSpreadBps: 120,
    rate: "1500",
    processingFee: "150",
    internalMargin: "0.0031",
    realizedProfit: null,
    realizedFee: null,
    realizedSpread: null,
  } as unknown as AdminTxnEconomics

  it("renders the six base rows, with the internal-margin row operator-only (warn)", () => {
    const rows = economicsRows(ECON)
    expect(rows.map((r) => r.label)).toEqual([
      "Amount",
      "Fiat leg",
      "Rate (spread-folded)",
      "Processing fee",
      "FX spread",
      "Internal margin (operator)",
    ])
    // Internal margin is left unformatted (sub-unit precision) + warn-toned.
    expect(rows.find((r) => r.label === "Internal margin (operator)")).toEqual({
      label: "Internal margin (operator)",
      value: "0.0031",
      warn: true,
    })
  })

  it("renders '—' for null fields and never fabricates", () => {
    const rows = economicsRows({
      ...ECON,
      rate: null,
      processingFee: null,
      internalMargin: null,
      fxSpreadBps: null,
    } as AdminTxnEconomics)
    expect(rows.find((r) => r.label === "Rate (spread-folded)")?.value).toBe("—")
    expect(rows.find((r) => r.label === "Processing fee")?.value).toBe("—")
    expect(rows.find((r) => r.label === "FX spread")?.value).toBe("—")
  })

  it("appends the three operator-only realized rows once realizedProfit is set", () => {
    const rows = economicsRows({
      ...ECON,
      realizedProfit: "900",
      realizedFee: "150",
      realizedSpread: "750",
    } as AdminTxnEconomics)
    const realized = rows.filter((r) => r.label.startsWith("Realized"))
    expect(realized.map((r) => r.label)).toEqual([
      "Realized fee (operator)",
      "Realized spread (operator)",
      "Realized profit (operator)",
    ])
    expect(realized.every((r) => r.warn)).toBe(true)
  })
})
