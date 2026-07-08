import { renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useQuoteCountdown } from "./use-quote-countdown"

describe("useQuoteCountdown", () => {
  it("derives remaining seconds from a future expiresAt", () => {
    const expiresAt = new Date(Date.now() + 90_000).toISOString()
    const { result } = renderHook(() => useQuoteCountdown(expiresAt, 0))
    expect(result.current.remaining).toBeGreaterThan(85)
    expect(result.current.remaining).toBeLessThanOrEqual(90)
    expect(result.current.isExpired).toBe(false)
  })

  it("is expired for a past expiresAt", () => {
    const expiresAt = new Date(Date.now() - 5_000).toISOString()
    const { result } = renderHook(() => useQuoteCountdown(expiresAt, 0))
    expect(result.current.remaining).toBe(0)
    expect(result.current.isExpired).toBe(true)
  })

  it("falls back to lockSeconds when there is no expiresAt", () => {
    const { result } = renderHook(() => useQuoteCountdown(undefined, 30))
    expect(result.current.remaining).toBe(30)
    expect(result.current.isExpired).toBe(false)
  })

  it("is expired when neither source has time left", () => {
    const { result } = renderHook(() => useQuoteCountdown(undefined, 0))
    expect(result.current.isExpired).toBe(true)
  })
})
