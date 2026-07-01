/**
 * Zustand theme store — light/dark preference for the operator console.
 *
 * Architecture notes (mirrors admin-auth-store's dual export):
 * - `createThemeStore` is the testable vanilla factory (no React).
 *   Tests create isolated instances to avoid cross-test state pollution.
 * - `defaultThemeStore` is the module-level singleton (vanilla StoreApi).
 *   Non-React code (the theme-provider effect / a headless toggle) can call
 *   `.getState()` on it directly.
 * - `useThemeStore` is the React hook bound to the singleton.
 *
 * Persistence: the preference is persisted to `localStorage` (key
 * `ha.admin.theme`) so it survives reloads and new tabs. It is rehydrated on
 * init; the design defaults to `'light'` (spec §1, `state.theme = 'light'`).
 * The DOM `.dark` class is toggled by `components/theme-provider.tsx`, never
 * here — the store owns state only (strict lib/ ⇄ components/ layering).
 */

import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"

// ─── LocalStorage key ───────────────────────────────────────────────────────────

const THEME_STORAGE_KEY = "ha.admin.theme"

// ─── State interface ────────────────────────────────────────────────────────────

export type Theme = "light" | "dark"

export interface ThemeState {
  theme: Theme

  /** Flip between light and dark. */
  toggle(): void

  /** Set the theme explicitly (e.g. from a menu). */
  set(theme: Theme): void
}

// ─── SSR-safe localStorage helpers ──────────────────────────────────────────────

function readTheme(): Theme {
  if (typeof window === "undefined") return "light"
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "dark" ? "dark" : "light"
  } catch {
    // SecurityError in sandboxed iframes, etc.
    return "light"
  }
}

function persistTheme(theme: Theme): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Best-effort persistence; don't crash on quota / security errors.
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────────

/**
 * Create a vanilla Zustand theme store.
 * Returns a `StoreApi<ThemeState>` — use `.getState()` / `.setState()`.
 *
 * Rehydrates the persisted preference from localStorage on init so a reload
 * keeps the operator's chosen theme; defaults to `'light'` when unset.
 */
export function createThemeStore() {
  return createStore<ThemeState>()((set, get) => ({
    theme: readTheme(),

    toggle() {
      const next: Theme = get().theme === "dark" ? "light" : "dark"
      persistTheme(next)
      set({ theme: next })
    },

    set(theme) {
      persistTheme(theme)
      set({ theme })
    },
  }))
}

// ─── React singleton binding ──────────────────────────────────────────────────────

/**
 * Module-level singleton vanilla store.
 * The theme provider and any non-React caller use this directly.
 */
export const defaultThemeStore = createThemeStore()

export type ThemeStore = ReturnType<typeof createThemeStore>

/**
 * React hook bound to the module-default singleton theme store.
 *
 * @example
 *   const theme = useThemeStore((s) => s.theme)
 *   const toggle = useThemeStore((s) => s.toggle)
 */
export function useThemeStore(): ThemeState
export function useThemeStore<U>(selector: (state: ThemeState) => U): U
export function useThemeStore<U>(
  selector?: (state: ThemeState) => U
): U | ThemeState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultThemeStore, selector)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultThemeStore)
}
