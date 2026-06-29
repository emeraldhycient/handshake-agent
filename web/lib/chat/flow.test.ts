import { describe, expect, it } from "vitest"
import type { QuoteView, TicketsView } from "@/lib/schemas"
import {
  buildResponse,
  buildConfirmForQuote,
  buildBuyConfirm,
  buildSendConfirm,
  buildSwapConfirm,
  buildTicketConfirm,
  buildReceipt,
  startChips,
  chipLabel,
  assistantText,
} from "./flow"

describe("flow", () => {
  // ─── assistantText helper ───────────────────────────────────────────────────

  it("assistantText returns a TextView", () => {
    expect(assistantText("hi")).toEqual({ kind: "text", text: "hi" })
  })

  // ─── buildResponse("buy") ───────────────────────────────────────────────────

  it("buy response yields text + quote", () => {
    const { messages } = buildResponse("buy")
    expect(messages[0]).toMatchObject({ kind: "text" })
    expect(messages[1]).toMatchObject({
      kind: "quote",
      receiveAmt: "29.97 USDT",
      totalValue: "₦50,000.00",
    })
    expect((messages[1] as QuoteView).rows).toHaveLength(4)
  })

  it("buy quote has receiveSub, full rows, totalLabel, action, lockSeconds", () => {
    const q = buildResponse("buy").messages[1] as QuoteView
    expect(q.receiveSub).toBe("≈ what lands in your wallet")
    expect(q.rows[0]).toEqual({ label: "You pay", value: "₦50,000.00" })
    expect(q.rows[1]).toEqual({
      label: "Exchange rate",
      value: "₦1,640.00 / USDT",
    })
    // FX spread is never shown to users — it is folded into the effective rate
    expect(q.rows.every((r) => !r.label.toLowerCase().includes("spread"))).toBe(
      true
    )
    expect(q.rows[2]).toEqual({ label: "Processing fee", value: "₦250.00" })
    expect(q.rows[3]).toEqual({
      label: "Network fee · USDT on TRON",
      value: "₦150.00",
    })
    expect(q.totalLabel).toBe("Total to pay")
    expect(q.action).toBe("buy")
    expect(q.lockSeconds).toBe(60)
  })

  // ─── buildResponse("balance") ───────────────────────────────────────────────

  it("balance response yields text + balance card", () => {
    const { messages } = buildResponse("balance")
    expect(messages[1]).toMatchObject({ kind: "balance", total: "≈ ₦72,340" })
  })

  // ─── buildResponse("receive") ───────────────────────────────────────────────

  it("receive response yields text + receive card", () => {
    expect(buildResponse("receive").messages[1]).toMatchObject({
      kind: "receive",
      address: expect.stringContaining("TQn9"),
    })
  })

  // ─── buildResponse("send") ──────────────────────────────────────────────────

  it("send response yields text + quote with correct rows and totals", () => {
    const { messages } = buildResponse("send")
    expect(messages[0]).toMatchObject({ kind: "text" })
    const q = messages[1] as QuoteView
    expect(q.kind).toBe("quote")
    expect(q.action).toBe("send")
    expect(q.receiveAmt).toBe("25.00 USDT")
    expect(q.receiveSub).toBe("≈ ₦41,000 sent")
    expect(q.rows).toHaveLength(4)
    expect(q.rows[0]).toEqual({ label: "Amount", value: "25.00 USDT" })
    expect(q.rows[1]).toEqual({
      label: "Network",
      value: "USDT · TRON (TRC-20)",
    })
    expect(q.rows[2]).toEqual({ label: "Network fee", value: "1.00 USDT" })
    expect(q.rows[3]).toEqual({ label: "Handshake fee", value: "₦0.00" })
    expect(q.totalLabel).toBe("Total debited")
    expect(q.totalValue).toBe("26.00 USDT")
    expect(q.lockSeconds).toBe(60)
  })

  // ─── buildResponse("swap") ──────────────────────────────────────────────────

  it("swap response yields text + quote with correct rows and totals", () => {
    const { messages } = buildResponse("swap")
    expect(messages[0]).toMatchObject({ kind: "text" })
    const q = messages[1] as QuoteView
    expect(q.kind).toBe("quote")
    expect(q.action).toBe("swap")
    expect(q.receiveAmt).toBe("₦16,320")
    expect(q.receiveSub).toBe("≈ from 10.00 USDT")
    // Spread row removed — never shown to users
    expect(q.rows).toHaveLength(3)
    expect(q.rows[0]).toEqual({ label: "You swap", value: "10.00 USDT" })
    expect(q.rows[1]).toEqual({
      label: "Exchange rate",
      value: "₦1,640.00 / USDT",
    })
    // FX spread is never shown to users — it is folded into the effective rate
    expect(q.rows.every((r) => !r.label.toLowerCase().includes("spread"))).toBe(
      true
    )
    expect(q.rows[2]).toEqual({ label: "Handshake fee", value: "₦0.00" })
    expect(q.totalLabel).toBe("You receive")
    expect(q.totalValue).toBe("₦16,320")
    expect(q.lockSeconds).toBe(60)
  })

  // ─── buildResponse("ticket") ────────────────────────────────────────────────

  it("ticket response yields tickets card with 3 options", () => {
    const t = buildResponse("ticket").messages[1] as TicketsView
    expect(t.kind).toBe("tickets")
    expect(t.options).toHaveLength(3)
  })

  // ─── buildConfirmForQuote (exhaustive dispatcher) ──────────────────────────

  it("buildConfirmForQuote('buy') returns the buy ConfirmPayload", () => {
    const result = buildConfirmForQuote("buy")
    expect(result.action).toBe("buy")
    expect(result.heroAmount).toBe("29.97 USDT")
    expect(result.cta).toBe("Confirm with PIN")
  })

  it("buildConfirmForQuote('send') returns the send ConfirmPayload", () => {
    const result = buildConfirmForQuote("send")
    expect(result.action).toBe("send")
    expect(result.heroAmount).toBe("25.00 USDT")
    expect(result.cta).toBe("Confirm with PIN")
  })

  it("buildConfirmForQuote('swap') returns the swap ConfirmPayload", () => {
    const result = buildConfirmForQuote("swap")
    expect(result.action).toBe("swap")
    expect(result.heroAmount).toBe("₦16,320")
    expect(result.cta).toBe("Confirm with PIN")
  })

  it("buildConfirmForQuote throws for an invalid action", () => {
    // Cast to bypass TypeScript — tests the runtime exhaustive guard.
    expect(() =>
      buildConfirmForQuote("balance" as "buy" | "send" | "swap")
    ).toThrow('buildConfirmForQuote: no builder for "balance"')
  })

  // ─── buildBuyConfirm ────────────────────────────────────────────────────────

  it("buy confirm matches prototype", () => {
    expect(buildBuyConfirm()).toMatchObject({
      heroAmount: "29.97 USDT",
      cta: "Confirm with PIN",
      action: "buy",
      totalValue: "₦50,000.00",
    })
  })

  it("buy confirm has all fields", () => {
    const c = buildBuyConfirm()
    expect(c.title).toBe("Confirm purchase")
    expect(c.subtitle).toBe("Check every detail — this can't be undone.")
    expect(c.heroLabel).toBe("You receive")
    expect(c.heroAmount).toBe("29.97 USDT")
    expect(c.heroSub).toBe("into your Handshake USDT wallet")
    // FX spread is never shown to users — it is folded into the effective rate
    expect(c.rows).toHaveLength(4)
    expect(c.rows[0]).toEqual({
      label: "You pay (debited from bank)",
      value: "₦50,000.00",
    })
    expect(c.rows[1]).toEqual({
      label: "Exchange rate",
      value: "₦1,640.00 / USDT",
    })
    expect(c.rows.every((r) => !r.label.toLowerCase().includes("spread"))).toBe(
      true
    )
    expect(c.rows[2]).toEqual({ label: "Processing fee", value: "₦250.00" })
    expect(c.rows[3]).toEqual({
      label: "Network fee · USDT on TRON",
      value: "₦150.00",
    })
    expect(c.totalLabel).toBe("Total to pay")
    expect(c.totalValue).toBe("₦50,000.00")
    expect(c.cta).toBe("Confirm with PIN")
    expect(c.action).toBe("buy")
  })

  // ─── buildSendConfirm ───────────────────────────────────────────────────────

  it("send confirm carries the address + warn", () => {
    const c = buildSendConfirm()
    expect(c.toValue).toContain("TQn9")
    expect(c.warn).toBeTruthy()
    expect(c.totalValue).toBe("26.00 USDT")
  })

  it("send confirm has all fields", () => {
    const c = buildSendConfirm()
    expect(c.title).toBe("Confirm transfer")
    expect(c.subtitle).toBe(
      "Sending crypto is irreversible. Confirm the address."
    )
    expect(c.heroLabel).toBe("You send")
    expect(c.heroAmount).toBe("25.00 USDT")
    expect(c.heroSub).toBe("≈ ₦41,000 · on TRON")
    expect(c.toLabel).toBe("To address")
    expect(c.toValue).toBe("TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r")
    expect(c.warn).toBe(
      "First time sending to this address. Make sure it exactly matches your recipient — funds cannot be recovered."
    )
    expect(c.rows).toHaveLength(2)
    expect(c.rows[0]).toEqual({ label: "Amount", value: "25.00 USDT" })
    expect(c.rows[1]).toEqual({ label: "Network fee", value: "1.00 USDT" })
    expect(c.totalLabel).toBe("Total debited")
    expect(c.totalValue).toBe("26.00 USDT")
    expect(c.cta).toBe("Confirm with PIN")
    expect(c.action).toBe("send")
  })

  // ─── buildSwapConfirm ───────────────────────────────────────────────────────

  it("swap confirm matches prototype", () => {
    expect(buildSwapConfirm()).toMatchObject({
      heroAmount: "₦16,320",
      cta: "Confirm with PIN",
      action: "swap",
      totalValue: "₦16,320",
    })
  })

  it("swap confirm has all fields", () => {
    const c = buildSwapConfirm()
    expect(c.title).toBe("Confirm swap")
    expect(c.subtitle).toBe("Review the conversion before you confirm.")
    expect(c.heroLabel).toBe("You receive")
    expect(c.heroAmount).toBe("₦16,320")
    expect(c.heroSub).toBe("into your naira balance")
    // FX spread is never shown to users — it is folded into the effective rate
    expect(c.rows).toHaveLength(3)
    expect(c.rows[0]).toEqual({ label: "You swap", value: "10.00 USDT" })
    expect(c.rows[1]).toEqual({
      label: "Exchange rate",
      value: "₦1,640.00 / USDT",
    })
    expect(c.rows.every((r) => !r.label.toLowerCase().includes("spread"))).toBe(
      true
    )
    expect(c.rows[2]).toEqual({ label: "Handshake fee", value: "₦0.00" })
    expect(c.totalLabel).toBe("You receive")
    expect(c.totalValue).toBe("₦16,320")
    expect(c.cta).toBe("Confirm with PIN")
    expect(c.action).toBe("swap")
  })

  // ─── buildTicketConfirm ─────────────────────────────────────────────────────

  it("ticket confirm reflects tier", () => {
    expect(buildTicketConfirm("VIP", "₦75,000", "₦76,250")).toMatchObject({
      heroAmount: "VIP",
      totalValue: "₦76,250",
      action: "ticket",
    })
  })

  it("ticket confirm(Regular) has all fields", () => {
    const c = buildTicketConfirm("Regular", "₦25,000", "₦25,750")
    expect(c.title).toBe("Confirm ticket")
    expect(c.subtitle).toBe("Review your ticket before paying.")
    expect(c.heroLabel).toBe("Ticket")
    expect(c.heroAmount).toBe("Regular")
    expect(c.heroSub).toBe("Afrobeats Live 2026 · Sat 12 Jul, 8:00pm")
    expect(c.rows).toHaveLength(3)
    expect(c.rows[0]).toEqual({ label: "Ticket price", value: "₦25,000" })
    expect(c.rows[1]).toEqual({ label: "Service fee", value: "₦750.00" })
    expect(c.rows[2]).toEqual({ label: "Pay from", value: "Naira balance" })
    expect(c.totalLabel).toBe("Total to pay")
    expect(c.totalValue).toBe("₦25,750")
    expect(c.cta).toBe("Confirm with PIN")
    expect(c.action).toBe("ticket")
    expect(c.meta).toEqual({ tier: "Regular", total: "₦25,750" })
  })

  // ─── buildReceipt — buy ─────────────────────────────────────────────────────

  it("buy receipt", () =>
    expect(buildReceipt("buy")).toMatchObject({
      kind: "receipt",
      amount: "+ 29.97 USDT",
      txRef: expect.stringContaining("HS-"),
    }))

  it("buy receipt has all fields", () => {
    const r = buildReceipt("buy")
    expect(r.title).toBe("Purchase complete")
    expect(r.subtitle).toBe("USDT credited to your wallet")
    expect(r.amount).toBe("+ 29.97 USDT")
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]).toEqual({ label: "Paid", value: "₦50,000.00" })
    expect(r.rows[1]).toEqual({ label: "Rate", value: "₦1,640.00 / USDT" })
    expect(r.rows[2]).toEqual({ label: "Date", value: "18 Jun, 2:14pm" })
    expect(r.txRef).toBe("REF · HS-9F4C-22A1")
  })

  // ─── buildReceipt — send ────────────────────────────────────────────────────

  it("send receipt has all fields", () => {
    const r = buildReceipt("send")
    expect(r.kind).toBe("receipt")
    expect(r.title).toBe("Transfer sent")
    expect(r.subtitle).toBe("Broadcasting on TRON · confirming")
    expect(r.amount).toBe("- 26.00 USDT")
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]).toEqual({ label: "To", value: "TQn9Y2…d3pVgk7r" })
    expect(r.rows[1]).toEqual({ label: "Network fee", value: "1.00 USDT" })
    expect(r.rows[2]).toEqual({ label: "Date", value: "18 Jun, 2:16pm" })
    expect(r.txRef).toBe("TX · a91f…7c0e")
  })

  // ─── buildReceipt — swap ────────────────────────────────────────────────────

  it("swap receipt has all fields", () => {
    const r = buildReceipt("swap")
    expect(r.kind).toBe("receipt")
    expect(r.title).toBe("Swap complete")
    expect(r.subtitle).toBe("10 USDT converted to naira")
    expect(r.amount).toBe("+ ₦16,320")
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]).toEqual({ label: "Swapped", value: "10.00 USDT" })
    expect(r.rows[1]).toEqual({ label: "Rate", value: "₦1,640.00 / USDT" })
    expect(r.rows[2]).toEqual({ label: "Date", value: "18 Jun, 2:18pm" })
    expect(r.txRef).toBe("REF · HS-7B22-90C4")
  })

  // ─── buildReceipt — ticket ──────────────────────────────────────────────────

  it("ticket receipt has all fields (Regular meta)", () => {
    const r = buildReceipt("ticket", { tier: "Regular", total: "₦25,750" })
    expect(r.kind).toBe("receipt")
    expect(r.title).toBe("Ticket confirmed")
    expect(r.subtitle).toBe("Afrobeats Live 2026 · Regular")
    expect(r.amount).toBe("₦25,750")
    expect(r.rows).toHaveLength(3)
    expect(r.rows[0]).toEqual({ label: "Entry code", value: "AFL-26-7741" })
    expect(r.rows[1]).toEqual({ label: "Gate", value: "Eko Hotel · Gate B" })
    expect(r.rows[2]).toEqual({ label: "Date", value: "Sat 12 Jul, 8:00pm" })
    expect(r.txRef).toBe("Saved to Wallet · tap to view QR")
  })

  // ─── buildReceipt — throws on non-receipt actions ──────────────────────────

  it('buildReceipt("balance") throws', () => {
    expect(() => buildReceipt("balance")).toThrow(
      'buildReceipt: no receipt for action "balance"'
    )
  })

  it('buildReceipt("receive") throws', () => {
    expect(() => buildReceipt("receive")).toThrow(
      'buildReceipt: no receipt for action "receive"'
    )
  })

  // ─── Chip helpers ────────────────────────────────────────────────────────────

  it("startChips + labels", () => {
    expect(startChips()).toEqual(["buy", "balance", "send", "ticket"])
    expect(chipLabel("buy")).toBe("Buy ₦50,000 of USDT")
  })

  it("chip labels for all 4 start chips", () => {
    expect(chipLabel("buy")).toBe("Buy ₦50,000 of USDT")
    expect(chipLabel("balance")).toBe("Check my balance")
    expect(chipLabel("send")).toBe("Send 25 USDT")
    expect(chipLabel("ticket")).toBe("Buy an event ticket")
  })
})
