import { describe, expect, it } from "vitest"

import { isBulkConfirmError } from "./bulk"
import { ApiError } from "@/lib/api/client"

describe("isBulkConfirmError", () => {
  it("is true for the large-set confirmation 422", () => {
    expect(
      isBulkConfirmError(
        new ApiError("confirm", 422, "ADMIN_BULK_CONFIRMATION_REQUIRED")
      )
    ).toBe(true)
  })
  it("is false for another ApiError code", () => {
    expect(
      isBulkConfirmError(new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED"))
    ).toBe(false)
  })
  it("is false for a non-ApiError", () => {
    expect(isBulkConfirmError(new Error("boom"))).toBe(false)
    expect(isBulkConfirmError(null)).toBe(false)
  })
})
