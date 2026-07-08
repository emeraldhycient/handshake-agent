import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/client"
import { toErrorMessage } from "./error-message"

describe("toErrorMessage", () => {
  it("returns an ApiError's message", () => {
    expect(toErrorMessage(new ApiError("Forbidden", 403, "FORBIDDEN"))).toBe(
      "Forbidden"
    )
  })
  it("returns a plain Error's message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom")
  })
  it("stringifies a truthy non-Error and returns null for none", () => {
    expect(toErrorMessage("nope")).toBe("nope")
    expect(toErrorMessage(null)).toBeNull()
    expect(toErrorMessage(undefined)).toBeNull()
  })
})
