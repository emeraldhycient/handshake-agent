"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { useAdminSearch } from "@/lib/query/hooks"
import { buildResults } from "@/lib/nav/command-search"
import type { CommandPaletteProps, NavDestination } from "@/types/components"

/**
 * The ⌘K command-palette state machine: a debounced entity search merged with the
 * substring-matched nav destinations, full keyboard navigation (Up/Down move the
 * highlight, Enter navigates, Esc closes via the Dialog), and the global ⌘K/Ctrl+K
 * opener. It only ever `router.push`es an in-app route — moves no money, holds no
 * server state beyond the read (§3.1). Extracted so the palette is presentation.
 */
export function useCommandPalette({
  open,
  onOpenChange,
  destinations,
}: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)

  // Debounce the term (≥200ms, §13.7) before hitting the live search endpoint.
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 220)
    return () => clearTimeout(id)
  }, [query])
  const { data: entityData } = useAdminSearch(debounced)

  const results = useMemo(
    () => buildResults(entityData?.results ?? [], destinations, query),
    [entityData, destinations, query]
  )

  // The effective highlight, clamped to the current results during render — so shrinking
  // the list never leaves `active` pointing past the end (no reconciling effect needed).
  const activeIndex =
    results.length === 0 ? 0 : Math.min(active, results.length - 1)

  // Global ⌘K / Ctrl+K opener. Registered once; toggles the shell's state.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onOpenChange])

  // Reset the query + highlight on every open transition. Done in the change handler (an
  // event, not an effect) so there is no setState-in-effect.
  function handleOpenChange(next: boolean) {
    if (next) {
      setQuery("")
      setActive(0)
    }
    onOpenChange(next)
  }

  function go(dest: NavDestination | undefined) {
    if (!dest) return
    onOpenChange(false)
    router.push(dest.href)
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(results.length === 0 ? 0 : (activeIndex + 1) % results.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(
        results.length === 0
          ? 0
          : (activeIndex - 1 + results.length) % results.length
      )
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(results[activeIndex])
    }
  }

  const activeDescendant = results[activeIndex]
    ? `cmdk-opt-${results[activeIndex].href}`
    : undefined

  return {
    query,
    setQuery,
    results,
    activeIndex,
    setActive,
    handleOpenChange,
    go,
    onInputKeyDown,
    activeDescendant,
  }
}
