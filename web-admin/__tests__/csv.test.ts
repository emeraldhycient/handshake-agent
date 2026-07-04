import { describe, expect, it } from "vitest"

import { toCsv } from "@/lib/csv"

describe("toCsv", () => {
  it("writes a header row then one row per record, CRLF-separated", () => {
    const csv = toCsv(["date", "count"], [
      ["2026-06-01", 3],
      ["2026-06-02", 5],
    ])
    expect(csv).toBe("date,count\r\n2026-06-01,3\r\n2026-06-02,5")
  })

  it("quotes fields containing a comma, quote, or newline (RFC 4180)", () => {
    const csv = toCsv(["label", "note"], [
      ["a,b", 'say "hi"'],
      ["line1\nline2", "plain"],
    ])
    // comma → wrapped; embedded quote → doubled + wrapped; newline → wrapped.
    expect(csv).toBe(
      'label,note\r\n"a,b","say ""hi"""\r\n"line1\nline2",plain'
    )
  })

  it("coerces numbers to strings and renders an empty series as just the header", () => {
    expect(toCsv(["n"], [[0], [42]])).toBe("n\r\n0\r\n42")
    expect(toCsv(["a", "b"], [])).toBe("a,b")
  })
})
