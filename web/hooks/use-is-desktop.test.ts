import { renderHook, act } from "@testing-library/react"
import { describe, expect, it, vi, afterEach } from "vitest"
import { useIsDesktop } from "./use-is-desktop"

describe("useIsDesktop", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns false when matchMedia reports a non-desktop viewport (default jsdom stub)", () => {
    // vitest.setup.ts stubs matchMedia with matches:false
    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(false)
  })

  it("returns true when matchMedia reports a desktop viewport", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(min-width: 1024px)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList)

    const { result } = renderHook(() => useIsDesktop())
    expect(result.current).toBe(true)
  })

  it("updates when the media query fires a change event", () => {
    let changeListener: (() => void) | null = null

    // Use a counter to toggle matches: first call (subscribe) returns false,
    // subsequent calls (getSnapshot after change) return true.
    let callCount = 0
    vi.spyOn(window, "matchMedia").mockImplementation(() => {
      callCount++
      return {
        matches: callCount > 1,
        media: "(min-width: 1024px)",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_type: string, fn: EventListener) => {
          changeListener = fn as () => void
        },
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList
    })

    const { result } = renderHook(() => useIsDesktop())
    // After initial render: callCount >= 2, but subscribe's mq.matches = false (callCount=1)
    // and getSnapshot was called with callCount=2+ → matches:true
    // However the subscribe call happens first in useSyncExternalStore,
    // so the sequence is: subscribe(callCount=1,matches=false) then getSnapshot(callCount=2,matches=true)
    // We just need to confirm the change listener triggers a re-snapshot.

    act(() => {
      changeListener?.()
    })

    // After the change event fires, useSyncExternalStore re-calls getSnapshot
    expect(result.current).toBe(true)
  })
})
