"use client"

import { useMemo, useState } from "react"
import { useSearchCatalog } from "@/lib/query/hooks"
import type { SearchResult } from "@/lib/schemas"
import type { TopbarSearchProps } from "@/types/topbar"

/** Topbar search pill + results dropdown. Owns its open/query state + catalog query. */
export function TopbarSearch({
  onSearchSelect,
  onQuickAction,
}: TopbarSearchProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const {
    data: catalog = [],
    isLoading: searchLoading,
    isError: searchError,
  } = useSearchCatalog()

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? catalog.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.desc.toLowerCase().includes(q) ||
            r.kind.toLowerCase().includes(q)
        )
      : catalog.slice(0, 5)
    return filtered.slice(0, 5)
  }, [catalog, searchQuery])

  function handleSelectResult(result: SearchResult) {
    setSearchOpen(false)
    setSearchQuery("")
    if (result.action && result.label) {
      onQuickAction(result.action, result.label)
    }
    onSearchSelect(result)
  }

  return (
    <div className="relative w-[300px]">
      <div className="flex items-center gap-[9px] rounded-full border border-border bg-card px-[15px] py-[9px]">
        <svg
          width="15"
          height="15"
          viewBox="0 0 15 15"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="6.5"
            cy="6.5"
            r="4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-muted-foreground-subtle"
          />
          <path
            d="M10 10l3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-muted-foreground-subtle"
          />
        </svg>
        <input
          role="combobox"
          aria-expanded={searchOpen}
          aria-haspopup="listbox"
          aria-controls="dashboard-search-listbox"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
          placeholder="Search or ask Handshake…"
          aria-label="Search"
          className="min-w-0 flex-1 border-none bg-transparent font-[inherit] text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground-subtle"
        />
      </div>

      {searchOpen && (
        <div
          id="dashboard-search-listbox"
          role="listbox"
          className="absolute top-12 left-0 z-40 w-[344px] overflow-hidden rounded-[16px] border border-border bg-card p-1.5 shadow-dropdown"
        >
          {searchLoading && (
            <p className="px-[11px] py-[10px] text-[13.5px] text-muted-foreground-subtle">
              Searching…
            </p>
          )}
          {!searchLoading && searchError && (
            <p className="px-[11px] py-[10px] text-[13.5px] text-danger">
              Couldn&apos;t load results
            </p>
          )}
          {!searchLoading && !searchError && searchResults.length === 0 && (
            <p className="px-[11px] py-[10px] text-[13.5px] text-muted-foreground-subtle">
              {searchQuery.trim()
                ? `No results for "${searchQuery}"`
                : "Start typing to search…"}
            </p>
          )}
          {!searchLoading &&
            !searchError &&
            searchResults.map((r) => (
              <div
                key={`${r.kind}-${r.title}`}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelectResult(r)
                }}
                className="flex cursor-pointer items-center gap-[11px] rounded-[11px] px-[11px] py-[10px] hover:bg-card-muted"
              >
                <div
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[15px] font-bold"
                  style={{ background: r.tint, color: r.col }}
                >
                  {r.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-foreground">
                    {r.title}
                  </p>
                  <p className="text-xs text-muted-foreground-subtle">
                    {r.desc}
                  </p>
                </div>
                <span className="flex-none text-[10.5px] font-bold tracking-[0.04em] text-muted-foreground-subtle uppercase">
                  {r.kind}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
