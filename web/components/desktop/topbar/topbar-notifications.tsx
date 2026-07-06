"use client"

import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useNotifications } from "@/lib/query/hooks"

/** Stable keys for the notifications loading skeleton (fixed placeholder rows). */
const NOTIF_SKELETON_ROWS = ["a", "b", "c"] as const

/** Topbar notifications bell + dropdown. Owns its open/read state + query. */
export function TopbarNotifications() {
  const [notifOpen, setNotifOpen] = useState(false)
  const [markedRead, setMarkedRead] = useState(false)

  const {
    data: notifications = [],
    isLoading: notifLoading,
    isError: notifError,
  } = useNotifications()

  const unreadCount = markedRead ? 0 : notifications.length

  function handleMarkAllRead() {
    setMarkedRead(true)
    setNotifOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setNotifOpen((v) => !v)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-card-muted"
      >
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
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-[17px] items-center justify-center rounded-full border-2 border-card-muted bg-accent px-1 py-px text-[10.5px] leading-none font-extrabold text-accent-foreground">
            {unreadCount}
          </span>
        )}
      </button>

      {notifOpen && (
        <div className="absolute top-[52px] right-0 z-40 w-[332px] overflow-hidden rounded-[16px] border border-border bg-card shadow-dropdown">
          <div className="border-b border-border px-4 py-[13px] text-sm font-bold text-foreground">
            Notifications
          </div>

          {notifLoading && (
            <div
              data-testid="notif-loading"
              role="status"
              aria-busy="true"
              aria-label="Loading notifications"
              className="px-4 py-2"
            >
              {NOTIF_SKELETON_ROWS.map((row) => (
                <div
                  key={row}
                  aria-hidden="true"
                  className="flex items-start gap-[11px] py-3"
                >
                  <Skeleton className="h-8 w-8 flex-none rounded-[9px]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!notifLoading && notifError && (
            <p className="px-4 py-6 text-sm text-danger">
              Couldn&apos;t load notifications
            </p>
          )}

          {!notifLoading && !notifError && notifications.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No notifications
            </p>
          )}

          {!notifLoading &&
            !notifError &&
            notifications.map((n) => (
              <div
                key={`${n.title}-${n.time}`}
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
            ))}

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
  )
}
