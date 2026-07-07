import { describe, expect, it } from "vitest"
import type {
  AdminEndUserDetail,
  KycSubmissionDetail,
} from "@handshake-agent/contracts"

import {
  approveTargetTier,
  beneVerificationMeta,
  displayName,
  initialsOf,
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
