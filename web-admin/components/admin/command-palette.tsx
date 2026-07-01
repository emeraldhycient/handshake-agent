"use client"

/**
 * CommandPalette — the ⌘K global navigator (design chrome §4.2 `openCmdk`).
 *
 * A Dialog opened by the topbar search pill OR the ⌘K / Ctrl+K shortcut. It
 * searches the shell's own nav destinations (passed in — every reachable
 * screen) by substring match, supports full keyboard navigation (Up/Down move
 * the highlight, Enter navigates, Esc closes) and mouse selection.
 *
 * It only ever `router.push`es to an in-app route — it moves no money and holds
 * no server state; the shell owns its open/close state (controlled component).
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "radix-ui"
import { CornerDownLeft, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import type { CommandPaletteProps, NavDestination } from "@/types/components"

/** Case-insensitive substring match on the label (and its group). */
function matches(dest: NavDestination, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    dest.label.toLowerCase().includes(q) || dest.group.toLowerCase().includes(q)
  )
}

export function CommandPalette({
  open,
  onOpenChange,
  destinations,
}: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const results = useMemo(
    () => destinations.filter((d) => matches(d, query)),
    [destinations, query]
  )

  // The effective highlight, clamped to the current results during render — so
  // shrinking the list never leaves `active` pointing past the end (no
  // reconciling effect / cascading render needed).
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

  // Scroll the highlighted option into view as it moves.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  // Reset the query + highlight on every open/close transition. Done in the
  // change handler (an event, not an effect) so there is no setState-in-effect.
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-green-deep/60 supports-backdrop-filter:backdrop-blur-[3px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          data-slot="command-palette"
          aria-label="Command palette"
          className="fixed top-[14vh] left-1/2 z-50 w-full max-w-[560px] -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-card shadow-flow outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">
            Search screens
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Type to filter, arrow keys to move, Enter to open.
          </DialogPrimitive.Description>

          {/* Search field */}
          <div className="flex items-center gap-[10px] border-b border-line px-[14px]">
            <Search
              aria-hidden="true"
              className="size-[18px] flex-none text-ink3"
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search users, tx, tickets…"
              role="combobox"
              aria-expanded
              aria-controls="command-palette-list"
              aria-activedescendant={
                results[activeIndex]
                  ? `cmdk-opt-${results[activeIndex].href}`
                  : undefined
              }
              className="h-[52px] rounded-none border-0 bg-transparent px-0 text-[15px] focus-visible:ring-0"
            />
            <span className="hidden flex-none rounded-[6px] border border-line bg-field px-[6px] py-0.5 font-mono text-[11px] font-semibold text-ink3 sm:inline">
              Esc
            </span>
          </div>

          {/* Results */}
          {results.length === 0 ? (
            <p className="px-[16px] py-[28px] text-center text-[13px] text-ink3">
              No results for “{query.trim()}”
            </p>
          ) : (
            <ul
              ref={listRef}
              id="command-palette-list"
              role="listbox"
              aria-label="Screens"
              className="max-h-[52vh] overflow-y-auto p-[8px]"
            >
              {results.map((dest, i) => {
                const isActive = i === activeIndex
                return (
                  <li key={dest.href} role="presentation">
                    <button
                      type="button"
                      id={`cmdk-opt-${dest.href}`}
                      role="option"
                      aria-selected={isActive}
                      data-active={isActive}
                      onMouseMove={() => setActive(i)}
                      onClick={() => go(dest)}
                      className={cn(
                        "flex w-full items-center gap-[10px] rounded-xl px-[12px] py-[9px] text-left transition-colors outline-none",
                        isActive ? "bg-hov" : "hover:bg-hov"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-ink">
                          {dest.label}
                        </span>
                        <span className="block truncate text-[11px] font-medium text-ink3">
                          {dest.group}
                        </span>
                      </span>
                      {isActive && (
                        <CornerDownLeft
                          aria-hidden="true"
                          className="size-[15px] flex-none text-ink3"
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
