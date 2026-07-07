import { describe, expect, it } from "vitest"

import { formatDate } from "./format"

describe("formatDate", () => {
  it("em-dashes null, else renders a locale string", () => {
    expect(formatDate(null)).toBe("—")
    expect(formatDate("2026-07-01T00:00:00.000Z")).not.toBe("—")
  })
})
