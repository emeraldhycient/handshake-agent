import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useInstallPrompt } from "./use-install-prompt"

/** Build a fake beforeinstallprompt event with a controllable userChoice. */
function makeBip(outcome: "accepted" | "dismissed") {
  const evt = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }
  evt.prompt = vi.fn().mockResolvedValue(undefined)
  evt.userChoice = Promise.resolve({ outcome })
  return evt
}

function mockMatchMedia(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("standalone") ? standalone : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: ua,
  })
}

describe("useInstallPrompt", () => {
  afterEach(() => {
    mockMatchMedia(false)
    setUserAgent("node")
    vi.restoreAllMocks()
  })

  it("starts with nothing to prompt and not installed", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.canPrompt).toBe(false)
    expect(result.current.isInstalled).toBe(false)
  })

  it("becomes promptable when the browser fires beforeinstallprompt", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      window.dispatchEvent(makeBip("accepted"))
    })
    expect(result.current.canPrompt).toBe(true)
  })

  it("resolves 'unavailable' when prompted with no captured event", async () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useInstallPrompt())
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.promptInstall()
    })
    expect(outcome).toBe("unavailable")
  })

  it("fires the native prompt and returns the user's choice, then clears it", async () => {
    mockMatchMedia(false)
    const bip = makeBip("accepted")
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      window.dispatchEvent(bip)
    })
    let outcome: string | undefined
    await act(async () => {
      outcome = await result.current.promptInstall()
    })
    expect(bip.prompt).toHaveBeenCalledOnce()
    expect(outcome).toBe("accepted")
    // A prompt can only be used once — it must no longer be promptable.
    expect(result.current.canPrompt).toBe(false)
  })

  it("reports installed when running in standalone display mode", () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.isInstalled).toBe(true)
  })

  it("marks installed and clears the prompt after the appinstalled event", () => {
    mockMatchMedia(false)
    const { result } = renderHook(() => useInstallPrompt())
    act(() => {
      window.dispatchEvent(makeBip("accepted"))
    })
    expect(result.current.canPrompt).toBe(true)
    act(() => {
      window.dispatchEvent(new Event("appinstalled"))
    })
    expect(result.current.isInstalled).toBe(true)
    expect(result.current.canPrompt).toBe(false)
  })

  it("detects iOS Safari (where beforeinstallprompt never fires)", () => {
    mockMatchMedia(false)
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    )
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.isIOS).toBe(true)
  })
})
