"use client"

import { useState, useMemo } from "react"
import { cn } from "@/lib/utils"
import { useNotifications, useSearchCatalog } from "@/lib/query/hooks"
import type { DashboardTopbarProps } from "@/types/components"
import type { SearchResult } from "@/lib/schemas"

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop dashboard topbar.
 * Port of prototype lines 575–616.
 *
 * Local state owns:
 *  - search open/query
 *  - unread count (cleared by "Mark all read")
 *  - notifications panel open/closed
 */
export function DashboardTopbar({
  onSearchSelect,
  onQuickAction,
  className,
}: DashboardTopbarProps) {
  // ── Search ──────────────────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  const { data: catalog = [] } = useSearchCatalog()

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

  // ── Notifications ───────────────────────────────────────────────────────────
  const [notifOpen, setNotifOpen] = useState(false)
  const [markedRead, setMarkedRead] = useState(false)

  const { data: notifications = [] } = useNotifications()
  const unreadCount = markedRead ? 0 : notifications.length

  function handleMarkAllRead() {
    setMarkedRead(true)
    setNotifOpen(false)
  }

  // ── Search result selection ─────────────────────────────────────────────────
  function handleSelectResult(result: SearchResult) {
    setSearchOpen(false)
    setSearchQuery("")
    // If the result is a chat action, also trigger the quick-action flow
    if (result.action && result.label) {
      onQuickAction(result.action, result.label)
    }
    onSearchSelect(result)
  }

  return (
    <header
      className={cn(
        "relative z-[25] flex h-[66px] flex-none items-center gap-4 border-b border-border bg-card-muted px-[26px]",
        className
      )}
    >
      {/* ── Greeting ──────────────────────────────────────────────────────── */}
      <div className="flex-1">
        <h1 className="text-[17px] font-bold text-foreground">
          Good afternoon, Amara
        </h1>
      </div>

      {/* ── Search pill ───────────────────────────────────────────────────── */}
      <div className="relative w-[300px]">
        <div className="flex items-center gap-[9px] rounded-full border border-border bg-card px-[15px] py-[9px]">
          {/* Search icon */}
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
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              // Delay close to allow mousedown on results to fire first
              setTimeout(() => setSearchOpen(false), 150)
            }}
            placeholder="Search or ask Handshake…"
            aria-label="Search"
            className="min-w-0 flex-1 border-none bg-transparent font-[inherit] text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground-subtle"
          />
        </div>

        {/* Search dropdown */}
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute top-12 left-0 z-40 w-[344px] overflow-hidden rounded-[16px] border border-border bg-card p-1.5 shadow-[0_16px_40px_rgba(20,40,32,0.16)]">
            {searchResults.map((r, i) => (
              <div
                key={i}
                onMouseDown={() => handleSelectResult(r)}
                role="option"
                aria-selected={false}
                className="flex cursor-pointer items-center gap-[11px] rounded-[11px] px-[11px] py-[10px] hover:bg-card-muted"
              >
                {/* Icon */}
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

      {/* ── Notifications bell ────────────────────────────────────────────── */}
      <div className="relative">
        <button
          type="button"
          aria-label="Notifications"
          onClick={() => setNotifOpen((v) => !v)}
          className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-card-muted"
        >
          {/* Bell SVG */}
          <svg
            width="17"
            height="17"
            viewBox="0 0 17 17"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 7a4.5 4.5 0 019 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
              className="text-muted-foreground"
            />
            <path
              d="M6.6 14a2 2 0 003.8 0"
              stroke="currentColor"
              strokeWidth="1.4"
              className="text-muted-foreground"
            />
          </svg>

          {/* Unread badge */}
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-[17px] items-center justify-center rounded-full border-2 border-card-muted bg-accent px-1 py-px text-[10.5px] leading-none font-extrabold text-accent-foreground">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Notifications dropdown */}
        {notifOpen && (
          <div className="absolute top-[52px] right-0 z-40 w-[332px] overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_16px_40px_rgba(20,40,32,0.16)]">
            <div className="border-b border-border px-4 py-[13px] text-sm font-bold text-foreground">
              Notifications
            </div>
            {notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                No notifications
              </p>
            ) : (
              notifications.map((n, i) => (
                <div
                  key={i}
                  className="flex items-start gap-[11px] border-b border-border px-4 py-3"
                >
                  <div
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[15px] font-bold"
                    style={{ background: n.tint, color: n.col }}
                  >
                    {n.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-bold text-foreground">
                      {n.title}
                    </p>
                    <p className="text-xs leading-[1.35] text-muted-foreground">
                      {n.sub}
                    </p>
                  </div>
                  <span className="flex-none text-[11px] text-muted-foreground-subtle">
                    {n.time}
                  </span>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="w-full cursor-pointer px-4 py-3 text-center text-[13px] font-bold text-primary transition-colors hover:bg-card-muted"
            >
              Mark all read
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
