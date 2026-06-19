import { describe, expect, it } from "vitest"
import {
  WalletAssetSchema,
  ActivityGroupSchema,
  AppNotificationSchema,
  SearchResultSchema,
  EventListItemSchema,
} from "./index"

// ─── WalletAssetSchema ────────────────────────────────────────────────────────

describe("WalletAssetSchema", () => {
  it("parses a valid wallet asset", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "USDT",
        name: "Tether",
        sub: "TRC-20",
        amount: "120.50 USDT",
        value: "₦72,300",
        change: "+0.01%",
        tint: "#7fd1a8",
      }).success
    ).toBe(true)
  })
  it("rejects a wallet asset missing tint", () => {
    expect(
      WalletAssetSchema.safeParse({
        sym: "USDT",
        name: "Tether",
        sub: "TRC-20",
        amount: "120.50 USDT",
        value: "₦72,300",
        change: "+0.01%",
        // tint omitted
      }).success
    ).toBe(false)
  })
})

// ─── ActivityGroupSchema ──────────────────────────────────────────────────────

describe("ActivityGroupSchema", () => {
  it("parses a valid activity group", () => {
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
            sCol: "#1f8a5b",
            sBg: "#e6f3ec",
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
            sCol: "#1f8a5b",
            sBg: "#e6f3ec",
          },
        ],
      }).success
    ).toBe(false)
  })
})

// ─── AppNotificationSchema ────────────────────────────────────────────────────

describe("AppNotificationSchema", () => {
  it("parses a valid notification", () => {
    expect(
      AppNotificationSchema.safeParse({
        icon: "🔔",
        tint: "#cfe6d8",
        col: "#1f8a5b",
        title: "Deposit confirmed",
        sub: "50 USDT received",
        time: "2 min ago",
      }).success
    ).toBe(true)
  })
  it("rejects a notification missing time", () => {
    expect(
      AppNotificationSchema.safeParse({
        icon: "🔔",
        tint: "#cfe6d8",
        col: "#1f8a5b",
        title: "Deposit confirmed",
        sub: "50 USDT received",
        // time omitted
      }).success
    ).toBe(false)
  })
})

// ─── SearchResultSchema ───────────────────────────────────────────────────────

describe("SearchResultSchema", () => {
  it("parses a valid Action search result", () => {
    expect(
      SearchResultSchema.safeParse({
        kind: "Action",
        title: "Buy Crypto",
        desc: "Purchase USDT",
        icon: "💰",
        tint: "#7fd1a8",
        col: "#1f8a5b",
        action: "buy",
      }).success
    ).toBe(true)
  })
  it("parses a valid Page search result", () => {
    expect(
      SearchResultSchema.safeParse({
        kind: "Page",
        title: "Wallet",
        desc: "View your assets",
        icon: "👛",
        tint: "#cfe6d8",
        col: "#1a4536",
        page: "wallet",
      }).success
    ).toBe(true)
  })
  it("rejects an unknown kind", () => {
    expect(
      SearchResultSchema.safeParse({
        kind: "Unknown",
        title: "x",
        desc: "y",
        icon: "z",
        tint: "#fff",
        col: "#000",
      }).success
    ).toBe(false)
  })
})

// ─── EventListItemSchema ──────────────────────────────────────────────────────

describe("EventListItemSchema", () => {
  it("parses a valid event list item", () => {
    expect(
      EventListItemSchema.safeParse({
        name: "Afrobeats Live",
        meta: "Lagos · Dec 2025",
        price: "From ₦25,000",
      }).success
    ).toBe(true)
  })
  it("rejects an event list item missing price", () => {
    expect(
      EventListItemSchema.safeParse({
        name: "Afrobeats Live",
        meta: "Lagos · Dec 2025",
        // price omitted
      }).success
    ).toBe(false)
  })
})
