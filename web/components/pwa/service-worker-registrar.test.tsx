import { afterEach, describe, expect, it, vi } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { ServiceWorkerRegistrar } from "./service-worker-registrar"

describe("ServiceWorkerRegistrar", () => {
  afterEach(() => {
    if ("serviceWorker" in navigator) {
      // @ts-expect-error test cleanup of the mocked property
      delete navigator.serviceWorker
    }
    vi.restoreAllMocks()
  })

  it("registers the service worker on mount and renders nothing", async () => {
    const register = vi.fn().mockResolvedValue({ scope: "/" })
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    })

    const { container } = render(<ServiceWorkerRegistrar />)

    await waitFor(() =>
      expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" })
    )
    expect(container).toBeEmptyDOMElement()
  })
})
