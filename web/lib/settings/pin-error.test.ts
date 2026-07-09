import { describe, expect, it } from "vitest"
import { ApiError, SESSION_EXPIRED_MESSAGE } from "@/lib/api/client"
import { PIN_ERROR_COPY } from "@/constants/settings"
import { pinErrorMessage } from "./pin-error"

describe("pinErrorMessage", () => {
  it("maps a PIN_LOCKED code to the lockout copy regardless of status", () => {
    const err = new ApiError(
      "Your PIN is temporarily locked. Please try again later.",
      401,
      "PIN_LOCKED"
    )
    expect(pinErrorMessage(err)).toBe(PIN_ERROR_COPY.locked)
  })

  it("maps a 401 (wrong PIN) to the wrong-PIN copy", () => {
    expect(
      pinErrorMessage(new ApiError("Authorization failed.", 401, "PIN_INVALID"))
    ).toBe(PIN_ERROR_COPY.wrongPin)
    expect(pinErrorMessage(new ApiError("Authorization failed.", 401))).toBe(
      PIN_ERROR_COPY.wrongPin
    )
  })

  it("never masks a dead session as a wrong PIN", () => {
    const err = new ApiError(SESSION_EXPIRED_MESSAGE, 401)
    expect(pinErrorMessage(err)).toBe(SESSION_EXPIRED_MESSAGE)
  })

  it("passes through the server's actionable policy message (422)", () => {
    const err = new ApiError("PIN must not be a simple sequence", 422, "PIN_WEAK")
    expect(pinErrorMessage(err)).toBe("PIN must not be a simple sequence")
  })

  it("falls back to generic copy for unknown errors", () => {
    expect(pinErrorMessage(new Error("boom"))).toBe(PIN_ERROR_COPY.generic)
    expect(pinErrorMessage(undefined)).toBe(PIN_ERROR_COPY.generic)
  })
})
