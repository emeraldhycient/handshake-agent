import { describe, expect, it } from "vitest"
import type { QuoteView, TicketsView } from "@/lib/schemas"
import {
  buildResponse,
  buildBuyConfirm,
  buildSendConfirm,
  buildSwapConfirm,
  buildTicketConfirm,
  buildReceipt,
  startChips,
  chipLabel,
} from "./flow"

describe("flow", () => {
  it("buy response yields text + quote", () => {
    const { messages } = buildResponse("buy")
    expect(messages[0]).toMatchObject({ kind: "text" })
    expect(messages[1]).toMatchObject({
      kind: "quote",
      receiveAmt: "29.97 USDT",
      totalValue: "₦50,000.00",
    })
    expect((messages[1] as QuoteView).rows).toHaveLength(5)
  })
  it("balance response yields text + balance card", () => {
    const { messages } = buildResponse("balance")
    expect(messages[1]).toMatchObject({ kind: "balance", total: "≈ ₦72,340" })
  })
  it("receive response yields text + receive card", () => {
    expect(buildResponse("receive").messages[1]).toMatchObject({
      kind: "receive",
      address: expect.stringContaining("TQn9"),
    })
  })
  it("ticket response yields tickets card with 3 options", () => {
    const t = buildResponse("ticket").messages[1] as TicketsView
    expect(t.kind).toBe("tickets")
    expect(t.options).toHaveLength(3)
  })
  it("buy confirm matches prototype", () => {
    expect(buildBuyConfirm()).toMatchObject({
      heroAmount: "29.97 USDT",
      cta: "Confirm with PIN",
      action: "buy",
      totalValue: "₦50,000.00",
    })
  })
  it("send confirm carries the address + warn", () => {
    const c = buildSendConfirm()
    expect(c.toValue).toContain("TQn9")
    expect(c.warn).toBeTruthy()
    expect(c.totalValue).toBe("26.00 USDT")
  })
  it("swap confirm matches prototype", () => {
    expect(buildSwapConfirm()).toMatchObject({
      heroAmount: "₦16,320",
      cta: "Confirm with PIN",
      action: "swap",
      totalValue: "₦16,320",
    })
  })
  it("ticket confirm reflects tier", () => {
    expect(buildTicketConfirm("VIP", "₦75,000", "₦76,250")).toMatchObject({
      heroAmount: "VIP",
      totalValue: "₦76,250",
      action: "ticket",
    })
  })
  it("buy receipt", () =>
    expect(buildReceipt("buy")).toMatchObject({
      kind: "receipt",
      amount: "+ 29.97 USDT",
      ref: expect.stringContaining("HS-"),
    }))
  it("startChips + labels", () => {
    expect(startChips()).toEqual(["buy", "balance", "send", "ticket"])
    expect(chipLabel("buy")).toBe("Buy ₦50,000 of USDT")
  })
})
