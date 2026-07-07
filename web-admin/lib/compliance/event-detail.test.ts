import { describe, expect, it } from "vitest"

import {
  buildDispositionInput,
  formatEventDate,
  severityVariant,
} from "./event-detail"

describe("formatEventDate", () => {
  it("em-dashes a null date", () => {
    expect(formatEventDate(null)).toBe("—")
  })
  it("formats a valid ISO date via toLocaleString", () => {
    const iso = "2026-07-02T00:00:00.000Z"
    expect(formatEventDate(iso)).toBe(new Date(iso).toLocaleString())
  })
})

describe("severityVariant", () => {
  it("maps critical/high to destructive, else secondary", () => {
    expect(severityVariant("critical")).toBe("destructive")
    expect(severityVariant("high")).toBe("destructive")
    expect(severityVariant("medium")).toBe("secondary")
    expect(severityVariant("low")).toBe("secondary")
  })
})

describe("buildDispositionInput", () => {
  it("omits a blank comment", () => {
    expect(buildDispositionInput("approved", "   ")).toEqual({
      status: "approved",
    })
  })
  it("includes a trimmed comment when present", () => {
    expect(buildDispositionInput("blocked", "  sanctions hit  ")).toEqual({
      status: "blocked",
      comment: "sanctions hit",
    })
  })
})
