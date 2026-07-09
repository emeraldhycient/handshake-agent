import { describe, expect, it } from "vitest"
import type { AdminEndUserListItem } from "@handshake-agent/contracts"

import { avatarHue, balanceLabel, relativeTime, toRow } from "./format"
import { AVATAR_HUES } from "@/constants/users"

describe("avatarHue", () => {
  it("is stable for the same id", () => {
    expect(avatarHue("abc-123")).toBe(avatarHue("abc-123"))
  })
  it("always returns a hue from the palette", () => {
    for (const id of ["a", "user-1", "22222222-2222", ""]) {
      expect(AVATAR_HUES).toContain(
        avatarHue(id) as (typeof AVATAR_HUES)[number]
      )
    }
  })
})

describe("relativeTime", () => {
  it("renders an em dash for null / unparseable timestamps", () => {
    expect(relativeTime(null)).toBe("—")
    expect(relativeTime("not-a-date")).toBe("—")
  })
  it("buckets seconds / minutes / hours / days", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    expect(relativeTime(ago(5_000))).toMatch(/^\d+s ago$/)
    expect(relativeTime(ago(5 * 60_000))).toBe("5m ago")
    expect(relativeTime(ago(3 * 3_600_000))).toBe("3h ago")
    expect(relativeTime(ago(2 * 86_400_000))).toBe("2d ago")
  })
})

describe("balanceLabel", () => {
  it("returns an em dash when nothing is held", () => {
    expect(balanceLabel([])).toBe("—")
    expect(balanceLabel([{ asset: "USDT", amount: "0" }])).toBe("—")
  })
  it("formats the primary asset and counts the rest", () => {
    expect(balanceLabel([{ asset: "USDT", amount: "1200.50" }])).toBe(
      "1,200.5 USDT"
    )
    expect(
      balanceLabel([
        { asset: "USDT", amount: "1200.50" },
        { asset: "TRX", amount: "30" },
      ])
    ).toBe("1,200.5 USDT +1")
  })
})

describe("toRow", () => {
  const base: AdminEndUserListItem = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara.okeke@example.com",
    displayName: "Amara Okeke",
    status: "active",
    kycStatus: "pending_review",
    kycTier: "tier_2",
    simSwapFlagged: false,
    sanctionsFlagged: true,
    balances: [{ asset: "USDT", amount: "1200.50" }],
    lastActiveAt: null,
    createdAt: new Date(0).toISOString(),
  }

  it("maps displayName, email, KYC bucket, tier and flags", () => {
    const row = toRow(base)
    expect(row.name).toBe("Amara Okeke")
    expect(row.initials).toBe("AO")
    expect(row.email).toBe("amara.okeke@example.com")
    expect(row.kyc).toBe("pending") // pending_review → Pending (awaiting review)
    expect(row.tier).toBe("tier_2")
    expect(row.sanctionsFlagged).toBe(true)
    expect(row.balance).toBe("1,200.5 USDT")
    expect(row.lastActive).toBe("—")
  })

  it("falls back to an em dash email when none is joined", () => {
    expect(toRow({ ...base, email: null }).email).toBe("—")
  })
})
