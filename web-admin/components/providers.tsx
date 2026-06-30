"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ThemeProvider } from "@/components/theme-provider"

/**
 * Admin app provider tree — TanStack Query for server state + next-themes for
 * theming. Deliberately minimal: the admin app gets its own auth/store wiring in
 * later tasks, separate from web's.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      })
  )
  return (
    <ThemeProvider attribute="class" forcedTheme="light">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}
