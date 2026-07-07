"use client"

/**
 * CommandPalette — the ⌘K global navigator (design chrome §4.2 `openCmdk`). Composition
 * only: `useCommandPalette` owns the debounced entity search + nav-destination filtering,
 * the keyboard navigation, and the global ⌘K/Ctrl+K opener; each result is a
 * `CommandResult`.
 *
 * It only ever `router.push`es an in-app route — it moves no money and holds no server
 * state beyond the read; the shell owns its open/close state (controlled component).
 */
import { useEffect, useRef } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { CommandResult } from "@/components/admin/command-palette/command-result"
import { useCommandPalette } from "@/lib/hooks/use-command-palette"
import type { CommandPaletteProps } from "@/types/components"

export function CommandPalette(props: CommandPaletteProps) {
  const c = useCommandPalette(props)
  const listRef = useRef<HTMLUListElement>(null)

  // Scroll the highlighted option into view as it moves.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [c.activeIndex])

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={c.handleOpenChange}>
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
              value={c.query}
              onChange={(e) => c.setQuery(e.target.value)}
              onKeyDown={c.onInputKeyDown}
              placeholder="Search users, tx, tickets…"
              role="combobox"
              aria-expanded
              aria-controls="command-palette-list"
              aria-activedescendant={c.activeDescendant}
              className="h-[52px] rounded-none border-0 bg-transparent px-0 text-[15px] focus-visible:ring-0"
            />
            <span className="hidden flex-none rounded-[6px] border border-line bg-field px-[6px] py-0.5 font-mono text-[11px] font-semibold text-ink3 sm:inline">
              Esc
            </span>
          </div>

          {/* Results */}
          {c.results.length === 0 ? (
            <p className="px-[16px] py-[28px] text-center text-[13px] text-ink3">
              No results for “{c.query.trim()}”
            </p>
          ) : (
            <ul
              ref={listRef}
              id="command-palette-list"
              role="listbox"
              aria-label="Screens"
              className="max-h-[52vh] overflow-y-auto p-[8px]"
            >
              {c.results.map((dest, i) => (
                <CommandResult
                  key={dest.href}
                  dest={dest}
                  isActive={i === c.activeIndex}
                  onActivate={() => c.setActive(i)}
                  onSelect={() => c.go(dest)}
                />
              ))}
            </ul>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
