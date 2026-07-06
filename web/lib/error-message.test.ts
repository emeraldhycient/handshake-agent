import { describe, expect, it } from "vitest"
import { toErrorMessage } from "./error-message"

describe("toErrorMessage", () => {
  it("returns the message of an Error", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom")
  })
  it("stringifies a truthy non-Error", () => {
    expect(toErrorMessage("nope")).toBe("nope")
  })
  it("returns null for no error", () => {
    expect(toErrorMessage(null)).toBeNull()
    expect(toErrorMessage(undefined)).toBeNull()
  })
})
