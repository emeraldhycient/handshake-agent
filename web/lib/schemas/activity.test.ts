import { describe, expect, it } from "vitest"
import { ActivityGroupSchema } from "./activity"

// ─── ActivityGroupSchema ──────────────────────────────────────────────────────

describe("ActivityGroupSchema", () => {
  it("parses a valid activity group with statusTone", () => {
    expect(
      ActivityGroupSchema.safeParse({
        group: "Today",
        items: [
          {
            dir: "in",
            icon: "↓",
            tint: "#7fd1a8",
            col: "#1f8a5b",
            title: "Received USDT",
            sub: "From Emeka",
            amount: "+ 50 USDT",
            status: "Completed",
            statusTone: "success",
          },
        ],
      }).success
    ).toBe(true)
  })

  it("rejects an item with an invalid dir", () => {
    expect(
      ActivityGroupSchema.safeParse({
        group: "Today",
        items: [
          {
            dir: "unknown",
            icon: "↓",
            tint: "#7fd1a8",
            col: "#1f8a5b",
            title: "Received USDT",
            sub: "From Emeka",
            amount: "+ 50 USDT",
            status: "Completed",
            statusTone: "success",
          },
        ],
      }).success
    ).toBe(false)
  })

  it("rejects an item with an invalid statusTone", () => {
    expect(
      ActivityGroupSchema.safeParse({
        group: "Today",
        items: [
          {
            dir: "in",
            icon: "↓",
            tint: "#7fd1a8",
            col: "#1f8a5b",
            title: "Received USDT",
            sub: "From Emeka",
            amount: "+ 50 USDT",
            status: "Completed",
            statusTone: "purple",
          },
        ],
      }).success
    ).toBe(false)
  })

  it("parses a ticket item with statusTone success", () => {
    expect(
      ActivityGroupSchema.safeParse({
        group: "Yesterday",
        items: [
          {
            dir: "ticket",
            icon: "🎟",
            tint: "#cfe6d8",
            col: "#1a4536",
            title: "Afrobeats Live",
            sub: "VIP · 1 ticket",
            amount: "₦76,250",
            status: "Confirmed",
            statusTone: "success",
          },
        ],
      }).success
    ).toBe(true)
  })
})
