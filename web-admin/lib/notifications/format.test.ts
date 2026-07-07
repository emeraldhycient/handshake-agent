import { describe, expect, it } from "vitest"

import {
  buildSchedule,
  eventLabel,
  pct,
  relativeTime,
  toTemplateOptions,
} from "./format"

describe("eventLabel", () => {
  it("spaces + sentence-cases the event type", () => {
    expect(eventLabel("kyc_approved")).toBe("Kyc approved")
    expect(eventLabel("")).toBe("")
  })
})

describe("relativeTime", () => {
  it("buckets just-now / minutes / hours / days, Yesterday at 1d", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    expect(relativeTime("nope")).toBe("—")
    expect(relativeTime(ago(10_000))).toBe("just now")
    expect(relativeTime(ago(5 * 60_000))).toBe("5m ago")
    expect(relativeTime(ago(3 * 3_600_000))).toBe("3h ago")
    expect(relativeTime(ago(24 * 3_600_000))).toBe("Yesterday")
    expect(relativeTime(ago(3 * 86_400_000))).toBe("3d ago")
  })
})

describe("toTemplateOptions", () => {
  it("dedups keys, preserving order", () => {
    expect(toTemplateOptions(["a", "b", "a"])).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ])
  })
})

describe("buildSchedule", () => {
  it("returns a scheduled send only for a valid custom time", () => {
    expect(buildSchedule("now", "")).toEqual({ kind: "now" })
    expect(buildSchedule("custom", "")).toEqual({ kind: "now" })
    expect(buildSchedule("custom", "not-a-date")).toEqual({ kind: "now" })
    const s = buildSchedule("custom", "2026-07-08T09:00")
    expect(s.kind).toBe("scheduled")
    if (s.kind === "scheduled") expect(s.sendAt).toMatch(/^2026-07-08T/)
  })
})

describe("pct", () => {
  it("formats a fraction as a trimmed percent", () => {
    expect(pct(0.004)).toBe("0.4%")
    expect(pct(0)).toBe("0%")
    expect(pct(0.1)).toBe("10%")
    expect(pct(0.0123)).toBe("1.23%")
  })
})
