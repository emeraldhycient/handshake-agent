import { describe, expect, it } from "vitest"
import {
  ChatMessageSchema,
  ChatActionSchema,
  SettlingViewSchema,
  SwapViewSchema,
  ConfirmPayloadSchema,
} from "./chat"
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
        txRef: "HS-20250101-ABCD",
      }).success
    ).toBe(true)
  })

  it("rejects a receipt message missing txRef", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m11",
        role: "assistant",
        kind: "receipt",
        title: "Purchase complete",
        subtitle: "USDT bought",
        amount: "+ 29.97 USDT",
        rows: [],
        // txRef omitted
      }).success
    ).toBe(false)
  })

  it("parses a pay_in message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m12",
        role: "assistant",
        kind: "pay_in",
        transactionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        accountNumber: "0123456789",
        bankName: "Test Bank",
        providerRef: "REF001",
        amount: "50250",
        currency: "NGN",
        status: "pending",
      }).success
    ).toBe(true)
  })

  it("rejects a pay_in message with invalid status", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m13",
        role: "assistant",
        kind: "pay_in",
        transactionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        accountNumber: "0123456789",
        bankName: "Test Bank",
        providerRef: "REF001",
        amount: "50250",
        currency: "NGN",
        status: "unknown_status",
      }).success
    ).toBe(false)
  })
})

describe("ChooseBeneficiaryViewSchema (nickname disambiguation)", () => {
  const base = {
    id: "m20",
    role: "assistant" as const,
    kind: "choose_beneficiary" as const,
    beneficiaryType: "bank_account" as const,
    nickname: "mum",
    candidates: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        label: "Mum",
        detail: "Guaranty Trust Bank (GTBank) ••6789",
      },
    ],
  }

  it("parses a choose_beneficiary message through the ChatMessageSchema union", () => {
    expect(ChatMessageSchema.safeParse(base).success).toBe(true)
  })

  it("rejects a choose_beneficiary message missing candidates", () => {
    expect(
      ChatMessageSchema.safeParse({ ...base, candidates: undefined }).success
    ).toBe(false)
  })

  it("rejects a candidate missing the masked detail", () => {
    expect(
      ChatMessageSchema.safeParse({
        ...base,
        candidates: [
          { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Mum" },
        ],
      }).success
    ).toBe(false)
  })
})

describe("NeedsBeneficiaryViewSchema.note (nickname miss copy)", () => {
  it("parses a needs_beneficiary message WITHOUT a note (backwards compatible)", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m21",
        role: "assistant",
        kind: "needs_beneficiary",
        beneficiaryType: "crypto_address",
      }).success
    ).toBe(true)
  })

  it("parses a needs_beneficiary message WITH a targeted note", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m22",
        role: "assistant",
        kind: "needs_beneficiary",
        beneficiaryType: "bank_account",
        note: "No saved beneficiary called 'mum'. Add one first, or pick from your saved list.",
      }).success
    ).toBe(true)
  })
})

describe("SettlingViewSchema.txType (swap support)", () => {
  const base = {
    kind: "settling" as const,
    transactionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    title: "Swap processing",
    subtitle: "Completing your swap on-chain.",
    rows: [{ label: "You receive", value: "1.2 TRX" }],
    reference: "swap-ref-1",
    status: "pending" as const,
  }

  it("accepts a settling card with txType 'swap'", () => {
    expect(
      SettlingViewSchema.safeParse({ ...base, txType: "swap" }).success
    ).toBe(true)
  })

  it("still accepts the existing 'sell' and 'send' txTypes", () => {
    expect(
      SettlingViewSchema.safeParse({ ...base, txType: "sell" }).success
    ).toBe(true)
    expect(
      SettlingViewSchema.safeParse({ ...base, txType: "send" }).success
    ).toBe(true)
  })

  it("rejects an unknown txType", () => {
    expect(
      SettlingViewSchema.safeParse({ ...base, txType: "borrow" }).success
    ).toBe(false)
  })

  it("parses a swap settling card through the full ChatMessageSchema union (no cast needed)", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m14",
        role: "assistant",
        ...base,
        txType: "swap",
      }).success
    ).toBe(true)
  })
})

describe("SwapViewSchema.feeAsset", () => {
  const base = {
    kind: "swap" as const,
    fromAsset: "USDT",
    toAsset: "TRX",
    fromAmount: "10",
    toAmount: "84.21",
    rate: "8.421",
    networkFee: "1.1",
    transactionFee: "0.2",
    estimatedArrivalSec: 60,
    expiresAt: "2026-06-30T12:00:00.000Z",
    lockSeconds: 60,
  }

  it("parses a swap view WITHOUT feeAsset (optional — backwards compatible)", () => {
    expect(SwapViewSchema.safeParse(base).success).toBe(true)
  })

  it("parses a swap view WITH an explicit feeAsset", () => {
    const r = SwapViewSchema.safeParse({ ...base, feeAsset: "TRX" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.feeAsset).toBe("TRX")
  })
})

describe("ConfirmPayloadSchema.expiresAt", () => {
  const base = {
    title: "Confirm swap",
    subtitle: "Review and confirm",
    heroLabel: "You receive",
    heroAmount: "84.21 TRX",
    heroSub: "≈ ₦…",
    rows: [{ label: "Rate", value: "8.421" }],
    totalLabel: "Total",
    totalValue: "10 USDT",
    cta: "Confirm",
    action: "swap" as const,
  }

  it("parses a confirm payload WITHOUT expiresAt (optional)", () => {
    expect(ConfirmPayloadSchema.safeParse(base).success).toBe(true)
  })

  it("carries an optional expiresAt so the confirm-sheet countdown can run", () => {
    const r = ConfirmPayloadSchema.safeParse({
      ...base,
      expiresAt: "2026-06-30T12:00:00.000Z",
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.expiresAt).toBe("2026-06-30T12:00:00.000Z")
  })
})
