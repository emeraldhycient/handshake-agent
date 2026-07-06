import { describe, expect, it } from "vitest"
import { truncateMiddle } from "./format"

describe("truncateMiddle", () => {
  it("keeps head=6 and tail=4 for a long address", () => {
    expect(truncateMiddle("TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ")).toBe(
      "TQn9Y2…m3vQ"
    )
  })
  it("returns short strings unchanged (≤ head+tail+1)", () => {
    expect(truncateMiddle("TQn9Y2khEb")).toBe("TQn9Y2khEb")
  })
})
