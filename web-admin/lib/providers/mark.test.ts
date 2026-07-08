import { describe, expect, it } from "vitest"

import { providerMark } from "./mark"

describe("providerMark", () => {
  it("takes the first letter of each of two words", () => {
    expect(providerMark("Trustless Work")).toBe("TW")
  })
  it("uses the first two letters of a single-word name", () => {
    expect(providerMark("Blockradar")).toBe("BL")
  })
  it("handles extra whitespace and lone letters", () => {
    expect(providerMark("  Flutterwave  ")).toBe("FL")
    expect(providerMark("X")).toBe("X")
  })
})
