import { describe, expect, it } from "vitest"
import { ChatMessageSchema, ChatActionSchema } from "./chat"

describe("ChatActionSchema", () => {
  it("accepts known actions", () => {
    for (const a of ["buy", "send", "receive", "swap", "ticket", "balance"])
      expect(ChatActionSchema.safeParse(a).success).toBe(true)
  })
  it("rejects unknown", () =>
    expect(ChatActionSchema.safeParse("nuke").success).toBe(false))
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
})
