import { describe, expect, it } from "vitest"
import type { SanctionsMonitoringView } from "@handshake-agent/contracts"

import { toMonitorRows } from "./format"

describe("toMonitorRows", () => {
  it("projects the view onto the four ordered rows, preserving each flag", () => {
    const view: SanctionsMonitoringView = {
      reScreenDaily: true,
      screenOnOutbound: false,
      pepAlert: true,
      autoBlockOfac: false,
    }
    const rows = toMonitorRows(view)
    expect(rows.map((r) => r.key)).toEqual([
      "reScreenDaily",
      "screenOnOutbound",
      "pepAlert",
      "autoBlockOfac",
    ])
    expect(rows.map((r) => r.on)).toEqual([true, false, true, false])
    expect(rows[0].label).toContain("Re-screen")
  })
})
