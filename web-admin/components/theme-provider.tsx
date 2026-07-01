"use client"

import { useEffect } from "react"

import { useThemeStore } from "@/lib/store/theme-store"

/**
 * Applies the operator-console theme to the DOM.
 *
 * The design switches themes by toggling a `dark` class on the root element
 * (spec §1 / re-skin note §7). This provider is the *only* place that touches
 * the DOM: it reads the preference from the Zustand theme store (`lib/`) and
 * mirrors it onto `document.documentElement` on mount and on every change. The
 * store owns state; this component owns the side effect — keeping the strict
 * `components/ → lib/` layering intact.
 *
 * The design's top-bar theme toggle calls `useThemeStore().toggle()`; this
 * effect then flips the class. Default is `'light'` (no `dark` class).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
  }, [theme])

  return <>{children}</>
}
