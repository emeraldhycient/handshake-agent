import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCountdown } from "./use-countdown"

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns null secondsLeft when expiresAt is undefined", () => {
    const { result } = renderHook(() => useCountdown(undefined))
    expect(result.current.secondsLeft).toBeNull()
    expect(result.current.expired).toBe(false)
  })

  it("returns null secondsLeft when expiresAt is null", () => {
    const { result } = renderHook(() => useCountdown(null))
    expect(result.current.secondsLeft).toBeNull()
    expect(result.current.expired).toBe(false)
  })

  it("decrements secondsLeft every second", () => {
    const expiresAt = new Date(Date.now() + 5000).toISOString()
    const { result } = renderHook(() => useCountdown(expiresAt))
    expect(result.current.secondsLeft).toBe(5)
    expect(result.current.expired).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.secondsLeft).toBe(4)

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it("expired is true when expiresAt is in the past", () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString()
    const { result } = renderHook(() => useCountdown(expiresAt))
    expect(result.current.secondsLeft).toBe(0)
    expect(result.current.expired).toBe(true)
  })

  it("cleans up interval on unmount (no memory leak)", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval")
    const expiresAt = new Date(Date.now() + 5000).toISOString()
    const { unmount } = renderHook(() => useCountdown(expiresAt))
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
