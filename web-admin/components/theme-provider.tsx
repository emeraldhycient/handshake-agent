"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/**
 * Thin wrapper over next-themes so the admin app theming is wired the same way
 * as web (`attribute="class"`). Kept minimal — the admin app has its own
 * provider tree, separate from web's auth/store providers.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
