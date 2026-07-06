import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api/client"
import {
  chatErrorMessage,
  isRetryablePinError,
  GENERIC_AGENT_ERROR,
} from "./errors"

describe("chatErrorMessage", () => {
  it("surfaces a 4xx ApiError's server message", () => {
    expect(chatErrorMessage(new ApiError("Insufficient balance", 422))).toBe(
      "Insufficient balance"
    )
  })
  it("falls back to the generic message for a 5xx ApiError", () => {
    expect(chatErrorMessage(new ApiError("boom", 500))).toBe(
      GENERIC_AGENT_ERROR
    )
  })
  it("falls back to the generic message for a plain Error", () => {
    expect(chatErrorMessage(new Error("network"))).toBe(GENERIC_AGENT_ERROR)
  })
})

describe("isRetryablePinError", () => {
  it("treats a 401 ApiError as a retryable PIN error", () => {
    expect(isRetryablePinError(new ApiError("PIN_INVALID", 401))).toBe(true)
  })
  it("does not treat a non-401 ApiError as retryable", () => {
    expect(isRetryablePinError(new ApiError("nope", 403))).toBe(false)
  })
  it("treats a plain Error as retryable (offline/mock path)", () => {
    expect(isRetryablePinError(new Error("wrong pin"))).toBe(true)
  })
})
