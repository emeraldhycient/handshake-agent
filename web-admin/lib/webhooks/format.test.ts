import { describe, expect, it } from "vitest"

import { formatDate, prettyJson, truncateId } from "./format"

describe("truncateId", () => {
  it("truncates ids longer than 24 chars with an ellipsis", () => {
    expect(truncateId("short")).toBe("short")
    const long = "a".repeat(30)
    expect(truncateId(long)).toBe(`${"a".repeat(24)}…`)
    expect(truncateId("a".repeat(24))).toBe("a".repeat(24))
  })
})

describe("formatDate", () => {
  it("em-dashes null, else renders a locale string", () => {
    expect(formatDate(null)).toBe("—")
    expect(formatDate("2026-07-01T00:00:00.000Z")).not.toBe("—")
  })
})

describe("prettyJson", () => {
  it("pretty-prints JSON with 2-space indent", () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
  it("falls back to String() on a circular value", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(prettyJson(circular)).toBe("[object Object]")
  })
})
