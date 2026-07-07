import { describe, expect, it } from "vitest"
import type { KycQueueItem } from "@handshake-agent/contracts"

import { formatSla, hashString, initialsFromEmail, toQueueRow } from "./rows"
import { AVA, SLA_DANGER_SECONDS } from "@/constants/kyc-review"

describe("hashString", () => {
  it("is deterministic and non-negative", () => {
    expect(hashString("user-1")).toBe(hashString("user-1"))
    expect(hashString("user-1")).toBeGreaterThanOrEqual(0)
  })
})

describe("initialsFromEmail", () => {
  it("takes the first letter of each of two local-part segments", () => {
    expect(initialsFromEmail("amara.okeke@x.io")).toBe("AO")
    expect(initialsFromEmail("jane_doe@x.io")).toBe("JD")
  })
  it("falls back to the first two chars, then '?'", () => {
    expect(initialsFromEmail("bob@x.io")).toBe("BO")
    expect(initialsFromEmail(null)).toBe("?")
  })
})

describe("formatSla", () => {
  it("renders s / m / h / d h buckets", () => {
    expect(formatSla(45)).toBe("45s")
    expect(formatSla(120)).toBe("2m")
    expect(formatSla(3 * 3600)).toBe("3h")
    expect(formatSla(28 * 3600)).toBe("1d 4h")
    expect(formatSla(48 * 3600)).toBe("2d")
  })
})

function item(
  over: Partial<KycQueueItem> & Pick<KycQueueItem, "userId">
): KycQueueItem {
  return {
    email: "amara.okeke@x.io",
    displayName: "Amara Okeke",
    requestedTier: "tier_2",
    slaAgeSeconds: 3600,
    status: "pending_review",
    submittedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  }
}

describe("toQueueRow", () => {
  it("maps an item, choosing a palette avatar and a tier label", () => {
    const row = toQueueRow(item({ userId: "u-1" }))
    expect(row.name).toBe("Amara Okeke")
    expect(row.initials).toBe("AO")
    expect(AVA).toContain(row.avatar)
    expect(row.tier).toBe("Tier 2")
    expect(row.sla).toBe("1h")
    expect(row.slaTone).toBe("ink")
    expect(row.assignee).toBe("")
  })
  it("falls back name→email→id and tints a stale SLA danger", () => {
    const row = toQueueRow(
      item({
        userId: "u-2",
        displayName: null,
        email: null,
        requestedTier: null,
        slaAgeSeconds: SLA_DANGER_SECONDS,
      })
    )
    expect(row.name).toBe("u-2")
    expect(row.tier).toBe("")
    expect(row.slaTone).toBe("danger")
  })
})
