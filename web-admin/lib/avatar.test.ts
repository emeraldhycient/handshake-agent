import { describe, expect, it } from "vitest"
import { initialsOf } from "./avatar"

describe("initialsOf", () => {
  it("uses the first letter of the first two words", () => {
    expect(initialsOf("Ada Tester")).toBe("AT")
  })
  it("uses the first two chars of a single word", () => {
    expect(initialsOf("Ada")).toBe("AD")
  })
  it("falls back to ? for an empty name", () => {
    expect(initialsOf("   ")).toBe("?")
  })
})
