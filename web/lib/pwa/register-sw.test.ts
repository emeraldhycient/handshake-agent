import { afterEach, describe, expect, it, vi } from "vitest"
import { registerServiceWorker } from "./register-sw"

function setServiceWorker(value: unknown) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value,
  })
}

describe("registerServiceWorker", () => {
  afterEach(() => {
    if ("serviceWorker" in navigator) {
      // @ts-expect-error test cleanup of the mocked property
      delete navigator.serviceWorker
    }
    vi.restoreAllMocks()
  })

  it("no-ops when the browser has no service worker support", async () => {
    expect("serviceWorker" in navigator).toBe(false)
    await expect(registerServiceWorker()).resolves.toBe(false)
  })

  it("registers /sw.js at the root scope when supported", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" })
    setServiceWorker({ register })
    await expect(registerServiceWorker()).resolves.toBe(true)
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" })
  })

  it("never throws when registration fails — a failed SW must not crash the app", async () => {
    const register = vi.fn().mockRejectedValue(new Error("boom"))
    setServiceWorker({ register })
    await expect(registerServiceWorker()).resolves.toBe(false)
  })
})
