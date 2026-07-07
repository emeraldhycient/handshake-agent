"use client"

import { useThemeStore } from "@/lib/store/theme-store"

/**
 * The Theme row (markup line 7) — label + description on the left, a click-to-flip
 * button showing `{{ themeName }}`. Wired to the theme store's `toggle`.
 */
export function ThemeRow() {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const themeName = theme === "light" ? "Light" : "Dark"
  return (
    <div className="flex items-center justify-between border-b border-line2 py-[12px]">
      <div>
        <div className="text-[12.5px] font-bold text-ink">Theme</div>
        <div className="text-[11px] text-ink3">Light / dark appearance</div>
      </div>
      <button
        type="button"
        onClick={() => toggleTheme()}
        aria-label={
          theme === "light" ? "Switch to dark theme" : "Switch to light theme"
        }
        className="flex items-center gap-[7px] rounded-[10px] border border-line px-[14px] py-2 text-[12.5px] font-bold text-ink transition-colors outline-none hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {themeName}
      </button>
    </div>
  )
}
