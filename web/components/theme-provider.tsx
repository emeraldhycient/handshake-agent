"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"

/**
 * next-themes renders an inline `<script>` to prevent flash-of-wrong-theme.
 * In React 19, rendering a `<script>` element inside a component tree triggers
 * a console.error ("Encountered a script tag while rendering React component").
 * Passing a non-JS `type` makes React treat it as a data block (not executable
 * JS), suppressing the warning. The script's theme-setting logic runs during
 * SSR before React hydrates; on the client, next-themes re-applies the theme
 * via useEffect, so marking it non-executable for client reconciliation is safe.
 */
const SCRIPT_PROPS = {
  // "text/plain" is not a JS MIME type so React's isScriptDataBlock() returns
  // true and skips the "Encountered a script tag" console.error.
  type: "text/plain",
} as const

function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={SCRIPT_PROPS}
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
