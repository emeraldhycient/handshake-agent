import { describe, expect, it } from "vitest"

import { parseRelatedEvents, parseReportContent } from "./report-draft"

describe("parseReportContent", () => {
  it("accepts a JSON object and returns its parsed value", () => {
    const result = parseReportContent('{"summary":"x","score":3}')
    expect(result).toEqual({ ok: true, value: { summary: "x", score: 3 } })
  })

  it("rejects syntactically invalid JSON", () => {
    expect(parseReportContent("{not json")).toEqual({
      ok: false,
      error: "Content is not valid JSON.",
    })
  })

  it("rejects an empty string (the cleared-textarea case)", () => {
    expect(parseReportContent("")).toEqual({
      ok: false,
      error: "Content is not valid JSON.",
    })
  })

  it("rejects a JSON array (not an object)", () => {
    expect(parseReportContent("[1,2,3]")).toEqual({
      ok: false,
      error: "Content must be a JSON object.",
    })
  })

  it("rejects JSON null", () => {
    expect(parseReportContent("null")).toEqual({
      ok: false,
      error: "Content must be a JSON object.",
    })
  })

  it("rejects a JSON primitive (number / string)", () => {
    expect(parseReportContent("42").ok).toBe(false)
    expect(parseReportContent('"a string"').ok).toBe(false)
  })
})

describe("parseRelatedEvents", () => {
  it("splits on newlines, trims, and drops blank lines", () => {
    expect(parseRelatedEvents("  evt-1 \n\n evt-2\n   \nevt-3  ")).toEqual([
      "evt-1",
      "evt-2",
      "evt-3",
    ])
  })

  it("returns an empty array for blank / whitespace-only input", () => {
    expect(parseRelatedEvents("")).toEqual([])
    expect(parseRelatedEvents("   \n  \n")).toEqual([])
  })
})
