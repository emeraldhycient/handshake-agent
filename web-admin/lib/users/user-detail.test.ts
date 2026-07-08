import { describe, expect, it } from "vitest"
import type {
  AdminEndUserDetail,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import {
  actionDot,
  actionLabel,
  approveTargetTier,
  beneVerificationMeta,
  displayName,
  fmtFiat,
  initialsOf,
  statusMeta,
  usageBar,
  usagePct,
} from "./user-detail"

const DETAIL = {
  id: "user-1",
  email: "amara.okoro@example.com",
} as unknown as AdminEndUserDetail

describe("displayName", () => {
  it("prefers the KYC full name", () => {
    expect(
      displayName(
        { firstName: "Amara", lastName: "Okoro" } as KycSubmissionDetail,
        DETAIL
      )
    ).toBe("Amara Okoro")
  })
  it("falls back to the email local-part, then the id", () => {
    expect(displayName(undefined, DETAIL)).toBe("amara.okoro")
    expect(
      displayName(undefined, { id: "user-1", email: "" } as AdminEndUserDetail)
    ).toBe("user-1")
  })
})

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Amara Okoro")).toBe("AO")
  })
  it("uses the first two letters of a single word", () => {
    expect(initialsOf("amara")).toBe("AM")
  })
  it("returns '?' for a blank name", () => {
    expect(initialsOf("   ")).toBe("?")
  })
})

describe("approveTargetTier", () => {
  it("keeps the requested verified tier", () => {
    expect(approveTargetTier({ tier: "tier_2" } as KycSubmissionDetail)).toBe(
      "tier_2"
    )
  })
  it("defaults to tier_1 for unverified / missing requested tier", () => {
    expect(approveTargetTier({ tier: "unverified" } as KycSubmissionDetail)).toBe(
      "tier_1"
    )
    expect(approveTargetTier(undefined)).toBe("tier_1")
  })
})

describe("beneVerificationMeta", () => {
  it("maps verified/match → Name match, reject/fail → Mismatch, else Unverified", () => {
    expect(beneVerificationMeta("verified").label).toBe("Name match")
    expect(beneVerificationMeta("name_match").label).toBe("Name match")
    expect(beneVerificationMeta("rejected").label).toBe("Mismatch")
    expect(beneVerificationMeta("failed").label).toBe("Mismatch")
    expect(beneVerificationMeta("pending").label).toBe("Unverified")
  })
})

describe("actionLabel / actionDot", () => {
  it("humanizes an action key by unslugging underscores", () => {
    expect(actionLabel("kyc_state_change")).toBe("kyc state change")
  })
  it("tints reject/block danger, override/reset amber, else neutral", () => {
    expect(actionDot("kyc_reject")).toBe("#c0563f")
    expect(actionDot("device_block")).toBe("#c0563f")
    expect(actionDot("tier_override")).toBe("#f5a623")
    expect(actionDot("pin_reset")).toBe("#f5a623")
    expect(actionDot("note_added")).toBe("#8b948a")
  })
})

describe("statusMeta", () => {
  it("maps known statuses and falls back for unknown ones (unslugged, neutral)", () => {
    expect(statusMeta("completed").l).toBe("Settled")
    expect(statusMeta("refunded").l).toBe("Refunded")
    expect(statusMeta("weird_state")).toEqual({
      l: "weird state",
      bg: "var(--card2)",
      fg: "var(--ink2)",
    })
  })
})

describe("fmtFiat", () => {
  it("groups + prefixes ₦ for NGN, a code for other currencies, and — for null", () => {
    expect(fmtFiat("1500000", "NGN")).toBe("₦1,500,000.00")
    expect(fmtFiat("1500", "USD")).toBe("$1,500.00")
    expect(fmtFiat(null, "NGN")).toBe("—")
  })
  it("returns the raw string for a non-numeric amount", () => {
    expect(fmtFiat("n/a", "NGN")).toBe("n/a")
  })
})

describe("usagePct", () => {
  it("clamps used/cap to 0–100%", () => {
    expect(usagePct("50", "200")).toBe("25%")
    expect(usagePct("300", "200")).toBe("100%")
    expect(usagePct("5", "0")).toBe("0%")
    expect(usagePct("x", "200")).toBe("0%")
  })
})

describe("usageBar", () => {
  it("tints red ≥90%, amber ≥75%, else green", () => {
    expect(usageBar("95%")).toBe("#c0563f")
    expect(usageBar("80%")).toBe("#f5a623")
    expect(usageBar("40%")).toBe("#1a4536")
  })
})
