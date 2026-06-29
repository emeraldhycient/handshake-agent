import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Force the in-memory mock gateway for the whole test suite ("mocks only for
// tests"). The runtime default is the REAL gateway, so without this the gateway
// singleton would try to hit the network. setupFiles run before the test module
// graph is imported, so this is set before gateway.ts reads it.
process.env.NEXT_PUBLIC_USE_MOCK = "true"

// jsdom does not implement window.matchMedia — required by next-themes
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

afterEach(() => cleanup())
