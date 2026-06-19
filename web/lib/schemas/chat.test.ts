import { describe, expect, it } from "vitest"
import { ChatMessageSchema, ChatActionSchema } from "./chat"
import { StatusToneSchema } from "./common"

describe("ChatActionSchema", () => {
  it("accepts known actions", () => {
    for (const a of ["buy", "send", "receive", "swap", "ticket", "balance"])
      expect(ChatActionSchema.safeParse(a).success).toBe(true)
  })
  it("rejects unknown", () =>
    expect(ChatActionSchema.safeParse("nuke").success).toBe(false))
})

describe("StatusToneSchema", () => {
  it("accepts all valid tones", () => {
    for (const t of ["success", "warn", "info", "neutral"])
      expect(StatusToneSchema.safeParse(t).success).toBe(true)
  })
  it("rejects an invalid tone", () =>
    expect(StatusToneSchema.safeParse("bogus").success).toBe(false))
})

describe("ChatMessageSchema", () => {
  it("parses a text message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m1",
        role: "assistant",
        kind: "text",
        text: "hi",
      }).success
    ).toBe(true)
  })

  it("parses a quote message with action field", () => {
    const r = ChatMessageSchema.safeParse({
      id: "m2",
      role: "assistant",
      kind: "quote",
      action: "buy",
      receiveAmt: "29.97 USDT",
      receiveSub: "x",
      rows: [{ label: "You pay", value: "₦50,000" }],
      totalLabel: "Total",
      totalValue: "₦50,000",
      lockSeconds: 60,
    })
    expect(r.success).toBe(true)
  })

  it("rejects a quote missing rows", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m3",
        role: "assistant",
        kind: "quote",
        action: "buy",
        receiveAmt: "x",
        receiveSub: "x",
        totalLabel: "t",
        totalValue: "v",
        lockSeconds: 60,
      }).success
    ).toBe(false)
  })

  it("parses a balance message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m4",
        role: "assistant",
        kind: "balance",
        total: "≈ ₦72,340",
        assets: [
          {
            sym: "USDT",
            name: "Tether",
            amount: "120.50 USDT",
            value: "₦72,300",
            tint: "#7fd1a8",
          },
        ],
      }).success
    ).toBe(true)
  })

  it("rejects a balance message missing total", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m5",
        role: "assistant",
        kind: "balance",
        assets: [],
        // total omitted
      }).success
    ).toBe(false)
  })

  it("parses a receive (deposit) message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m6",
        role: "assistant",
        kind: "receive",
        asset: "USDT",
        network: "TRON · TRC-20",
        address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ",
        minDeposit: "1 USDT",
        creditedEta: "~1 min",
      }).success
    ).toBe(true)
  })

  it("rejects a receive message missing address", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m7",
        role: "assistant",
        kind: "receive",
        asset: "USDT",
        network: "TRON",
        minDeposit: "1 USDT",
        creditedEta: "~1 min",
        // address omitted
      }).success
    ).toBe(false)
  })

  it("parses a tickets message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m8",
        role: "assistant",
        kind: "tickets",
        eventMeta: "Lagos · Dec 2025",
        eventName: "Afrobeats Live",
        options: [
          {
            tier: "Regular",
            perk: "General admission",
            price: "₦25,000",
            left: "142",
            total: "500",
          },
          {
            tier: "VIP",
            perk: "Backstage access",
            price: "₦75,000",
            left: "12",
            total: "50",
          },
        ],
      }).success
    ).toBe(true)
  })

  it("rejects a tickets message with wrong kind", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m9",
        role: "assistant",
        kind: "event",
        eventName: "Afrobeats Live",
        options: [],
      }).success
    ).toBe(false)
  })

  it("parses a receipt message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m10",
        role: "assistant",
        kind: "receipt",
        title: "Purchase complete",
        subtitle: "USDT bought successfully",
        amount: "+ 29.97 USDT",
        rows: [{ label: "Rate", value: "₦1,669/USDT" }],
        ref: "HS-20250101-ABCD",
      }).success
    ).toBe(true)
  })

  it("rejects a receipt message missing ref", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m11",
        role: "assistant",
        kind: "receipt",
        title: "Purchase complete",
        subtitle: "USDT bought",
        amount: "+ 29.97 USDT",
        rows: [],
        // ref omitted
      }).success
    ).toBe(false)
  })
})
