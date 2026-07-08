import { describe, expect, it } from "vitest"

import { expiryLabel } from "./format"

describe("expiryLabel", () => {
  it("formats a valid ISO date via toLocaleString", () => {
    const iso = "2026-07-02T00:00:00.000Z"
    expect(expiryLabel(iso)).toBe(new Date(iso).toLocaleString())
  })
  it("falls back to the raw string for an unparseable value", () => {
    expect(expiryLabel("not-a-date")).toBe("not-a-date")
  })
})
