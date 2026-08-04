/**
 * theme-store tests — the operator console's light/dark preference store.
 *
 * theme-store is the last of the three admin Zustand stores without a dedicated
 * suite (admin-auth-store and toast-store are both covered). It documents its
 * own testability ("createThemeStore is the testable vanilla factory — tests
 * create isolated instances"), so these exercise that factory directly. The
 * store owns STATE only: the DOM `.dark` class is toggled by
 * components/theme-provider.tsx, never here, so nothing below asserts on the
 * document.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"

import { createThemeStore } from "@/lib/store/theme-store"

const STORAGE_KEY = "ha.admin.theme"

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("theme-store", () => {
  describe("initial hydration", () => {
    it("defaults to light when nothing is persisted", () => {
      const store = createThemeStore()
      expect(store.getState().theme).toBe("light")
    })

    it("rehydrates 'dark' from localStorage on init", () => {
      window.localStorage.setItem(STORAGE_KEY, "dark")
      const store = createThemeStore()
      expect(store.getState().theme).toBe("dark")
    })

    it("falls back to light for any non-'dark' persisted value", () => {
      // A legacy/garbage value must not authenticate as a valid theme.
      window.localStorage.setItem(STORAGE_KEY, "system")
      const store = createThemeStore()
      expect(store.getState().theme).toBe("light")
    })

    it("defaults to light when the localStorage read throws (sandboxed / SecurityError)", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError")
      })
      const store = createThemeStore()
      expect(store.getState().theme).toBe("light")
    })
  })

  describe("toggle()", () => {
    it("flips light → dark and persists the new value", () => {
      const store = createThemeStore()
      store.getState().toggle()
      expect(store.getState().theme).toBe("dark")
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark")
    })

    it("flips dark → light and persists the new value", () => {
      window.localStorage.setItem(STORAGE_KEY, "dark")
      const store = createThemeStore()
      store.getState().toggle()
      expect(store.getState().theme).toBe("light")
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light")
    })
  })

  describe("set()", () => {
    it("sets dark explicitly and persists", () => {
      const store = createThemeStore()
      store.getState().set("dark")
      expect(store.getState().theme).toBe("dark")
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark")
    })

    it("sets light explicitly and persists", () => {
      window.localStorage.setItem(STORAGE_KEY, "dark")
      const store = createThemeStore()
      store.getState().set("light")
      expect(store.getState().theme).toBe("light")
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe("light")
    })
  })

  describe("persistence round-trip & isolation", () => {
    it("a preference persisted by one store rehydrates into a fresh store", () => {
      createThemeStore().getState().set("dark")
      // A new tab / reload builds a fresh store from the same localStorage.
      expect(createThemeStore().getState().theme).toBe("dark")
    })

    it("separate factory instances hold independent in-memory state", () => {
      const a = createThemeStore()
      const b = createThemeStore()
      a.getState().set("dark")
      expect(a.getState().theme).toBe("dark")
      // b hydrated to light at construction and is not mutated by a's write.
      expect(b.getState().theme).toBe("light")
    })

    it("keeps state updated even when persistence fails (best-effort write)", () => {
      const store = createThemeStore()
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceeded")
      })
      expect(() => store.getState().toggle()).not.toThrow()
      expect(store.getState().theme).toBe("dark")
    })
  })
})
