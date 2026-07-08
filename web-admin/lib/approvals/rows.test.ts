import { describe, expect, it } from "vitest"
import type { ChangeRequest } from "@handshake-agent/contracts"

import { diffRows, relativeAgo, requestTitle } from "./rows"

function change(
  over: Partial<ChangeRequest> & Pick<ChangeRequest, "id">
): ChangeRequest {
  return {
    kind: "pricing_change",
    resource: "pricing.assets.USDT.baseRates.NGN",
    payload: {},
    status: "pending",
    reason: "Cover rising FX volatility",
    requestedByAdminId: "admin-1",
    requestedByEmail: "tunde@handshake.test",
    decidedByAdminId: null,
    decidedByEmail: null,
    decisionReason: null,
    decidedAt: null,
    createdAt: "2026-06-30T10:00:00.000Z",
    ...over,
  }
}

describe("relativeAgo", () => {
  const base = new Date("2026-06-30T12:00:00.000Z").getTime()
  it("renders 'just now' under a minute", () => {
    expect(relativeAgo("2026-06-30T11:59:30.000Z", base)).toBe("just now")
  })
  it("renders minutes, hours, then days", () => {
    expect(relativeAgo("2026-06-30T11:26:00.000Z", base)).toBe("34m ago")
    expect(relativeAgo("2026-06-30T10:00:00.000Z", base)).toBe("2h ago")
    expect(relativeAgo("2026-06-27T12:00:00.000Z", base)).toBe("3d ago")
  })
  it("clamps a future timestamp to 'just now'", () => {
    expect(relativeAgo("2026-06-30T12:05:00.000Z", base)).toBe("just now")
  })
})

describe("diffRows", () => {
  it("renders a struck-old → new row for a { from, to } pair", () => {
    const rows = diffRows(
      change({
        id: "1",
        payload: { spread: { from: "85 bps", to: "110 bps" } },
      })
    )
    expect(rows).toEqual([{ field: "spread", from: "85 bps", to: "110 bps" }])
  })
  it("renders a 'set to' row (— → value) for a plain value", () => {
    const rows = diffRows(change({ id: "2", payload: { enabled: true } }))
    expect(rows).toEqual([{ field: "enabled", from: "—", to: "true" }])
  })
  it("falls back to a single resource row for an empty payload", () => {
    const rows = diffRows(
      change({ id: "3", resource: "Transaction:tx_9", payload: {} })
    )
    expect(rows).toEqual([
      { field: "Transaction:tx_9", from: "current", to: "requested change" },
    ])
  })
})

describe("requestTitle", () => {
  it("joins the kind label and the target resource", () => {
    expect(requestTitle(change({ id: "4" }))).toBe(
      "Pricing change · pricing.assets.USDT.baseRates.NGN"
    )
  })
})
