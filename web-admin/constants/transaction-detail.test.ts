import { describe, expect, it } from "vitest"

import {
  RECON_KIND_LABEL,
  STATUS_LABEL,
  STATUS_TO_PILL,
  TX_ACTIONS,
} from "./transaction-detail"

describe("STATUS_TO_PILL", () => {
  it("folds each engine status onto the intended pill status (money-triage signal)", () => {
    // A mis-fold (e.g. failed→settled) would mislead an operator triaging a stuck tx.
    expect(STATUS_TO_PILL).toEqual({
      pending: "initiated",
      validating: "quoted",
      confirmed: "quoted",
      settling: "pending_settlement",
      completed: "settled",
      failed: "failed",
      rolled_back: "refunded",
      cancelled: "failed",
    })
  })
})

describe("STATUS_LABEL / RECON_KIND_LABEL", () => {
  it("labels every engine status and recon-break kind", () => {
    expect(STATUS_LABEL.completed).toBe("Settled")
    expect(STATUS_LABEL.rolled_back).toBe("Rolled back")
    expect(Object.keys(STATUS_LABEL)).toHaveLength(8)
    expect(RECON_KIND_LABEL.over_credit).toBe("Over-credit")
    expect(Object.keys(RECON_KIND_LABEL)).toHaveLength(4)
  })
})

describe("TX_ACTIONS", () => {
  it("lists the five triage actions with Mark failed the only danger action", () => {
    expect(TX_ACTIONS.map((a) => a.kind)).toEqual([
      "retry",
      "refund",
      "markFailed",
      "recon",
      "receipt",
    ])
    expect(TX_ACTIONS.filter((a) => a.danger).map((a) => a.kind)).toEqual([
      "markFailed",
    ])
  })
})
