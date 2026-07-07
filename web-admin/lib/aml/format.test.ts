import { describe, expect, it } from "vitest"
import type { ComplianceEventItem } from "@handshake-agent/contracts"

import { caseMeta, caseTitle, thresholdFromParameters } from "./format"

describe("thresholdFromParameters", () => {
  it("renders key/value pairs (underscores spaced), em-dash when empty", () => {
    expect(thresholdFromParameters({})).toBe("—")
    expect(
      thresholdFromParameters({ daily_limit: 5000, window_hours: 24 })
    ).toBe("daily limit 5000 · window hours 24")
  })
})

const EVENT: ComplianceEventItem = {
  id: "ev1",
  userId: "abcdef1234567890",
  transactionId: "tx9876543210abcd",
  eventType: "velocity.breach",
  ruleOrHit: "velocity_daily_limit",
  severity: "high",
  status: "flagged",
  screeningProvider: "engine",
  createdAt: "2026-07-01T00:00:00.000Z",
}

describe("caseTitle", () => {
  it("humanises the event type and appends the rule/hit", () => {
    expect(caseTitle(EVENT)).toBe("velocity breach — velocity_daily_limit")
    expect(caseTitle({ ...EVENT, ruleOrHit: null })).toBe("velocity breach")
  })
})

describe("caseMeta", () => {
  it("joins severity · user · txn · date, omitting txn when absent", () => {
    const meta = caseMeta(EVENT)
    expect(meta).toContain("high severity")
    expect(meta).toContain("user abcdef12")
    expect(meta).toContain("txn tx987654")
    expect(caseMeta({ ...EVENT, transactionId: null })).not.toContain("txn ")
  })
})
