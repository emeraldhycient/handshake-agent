import { describe, expect, it } from "vitest"
import {
  balanceFixture,
  walletAssetsFixture,
  activityFixture,
  depositFixture,
  eventsFixture,
  notificationsFixture,
  searchCatalogFixture,
} from "./fixtures"
import {
  BalanceViewSchema,
  WalletAssetSchema,
  ActivityGroupSchema,
  DepositViewSchema,
  EventListItemSchema,
  AppNotificationSchema,
  SearchResultSchema,
} from "@/lib/schemas"

describe("balanceFixture", () => {
  it("parses through BalanceViewSchema without throwing", () => {
    expect(() => BalanceViewSchema.parse(balanceFixture)).not.toThrow()
  })
  it("has the expected total", () => {
    expect(balanceFixture.total).toBe("≈ ₦72,340")
  })
  it("has 3 assets", () => {
    expect(balanceFixture.assets).toHaveLength(3)
  })
})

describe("walletAssetsFixture", () => {
  it("every item parses WalletAssetSchema without throwing", () => {
    for (const asset of walletAssetsFixture) {
      expect(() => WalletAssetSchema.parse(asset)).not.toThrow()
    }
  })
  it("has 3 assets", () => {
    expect(walletAssetsFixture).toHaveLength(3)
  })
})

describe("activityFixture", () => {
  it("every group parses ActivityGroupSchema without throwing", () => {
    for (const group of activityFixture) {
      expect(() => ActivityGroupSchema.parse(group)).not.toThrow()
    }
  })
  it("has 2 groups (Today, Yesterday)", () => {
    expect(activityFixture).toHaveLength(2)
    expect(activityFixture[0].group).toBe("Today")
    expect(activityFixture[1].group).toBe("Yesterday")
  })
  it("uses statusTone (not sCol/sBg)", () => {
    const allItems = activityFixture.flatMap((g) => g.items)
    for (const item of allItems) {
      expect(item).toHaveProperty("statusTone")
      expect(item).not.toHaveProperty("sCol")
      expect(item).not.toHaveProperty("sBg")
    }
  })
  it("Completed items have statusTone=success", () => {
    const allItems = activityFixture.flatMap((g) => g.items)
    for (const item of allItems.filter((i) => i.status === "Completed")) {
      expect(item.statusTone).toBe("success")
    }
  })
  it("Confirming items have statusTone=warn", () => {
    const allItems = activityFixture.flatMap((g) => g.items)
    for (const item of allItems.filter((i) => i.status === "Confirming")) {
      expect(item.statusTone).toBe("warn")
    }
  })
})

describe("depositFixture", () => {
  it("parses through DepositViewSchema without throwing", () => {
    expect(() => DepositViewSchema.parse(depositFixture)).not.toThrow()
  })
  it("has the expected shape", () => {
    expect(depositFixture.kind).toBe("receive")
    expect(depositFixture.asset).toBe("USDT")
    expect(depositFixture.network).toBe("TRON · TRC-20")
    expect(depositFixture.address).toBe("TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ")
    expect(depositFixture.minDeposit).toBe("1 USDT")
    expect(depositFixture.creditedEta).toBe("~1 min")
  })
})

describe("eventsFixture", () => {
  it("every item parses EventListItemSchema without throwing", () => {
    for (const event of eventsFixture) {
      expect(() => EventListItemSchema.parse(event)).not.toThrow()
    }
  })
  it("has 3 events", () => {
    expect(eventsFixture).toHaveLength(3)
  })
})

describe("notificationsFixture", () => {
  it("every item parses AppNotificationSchema without throwing", () => {
    for (const notif of notificationsFixture) {
      expect(() => AppNotificationSchema.parse(notif)).not.toThrow()
    }
  })
  it("has 4 notifications", () => {
    expect(notificationsFixture).toHaveLength(4)
  })
})

describe("searchCatalogFixture", () => {
  it("every item parses SearchResultSchema without throwing", () => {
    for (const result of searchCatalogFixture) {
      expect(() => SearchResultSchema.parse(result)).not.toThrow()
    }
  })
  it("has 9 catalog items", () => {
    expect(searchCatalogFixture).toHaveLength(9)
  })
  it("contains NO fake Transaction rows (the catalog feeds the LIVE topbar search)", () => {
    expect(searchCatalogFixture.every((r) => r.kind !== "Transaction")).toBe(
      true
    )
  })
  it("action copy is currency-neutral (no ₦ / naira pins)", () => {
    for (const r of searchCatalogFixture) {
      const copy = `${r.title} ${r.desc} ${r.label ?? ""}`
      expect(copy).not.toMatch(/₦|naira/i)
    }
  })
})
